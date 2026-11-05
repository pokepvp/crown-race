// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Crown Race Pass — daily crown competition for Binance Agent ID holders
/// @notice A single self-contained ERC-721 (no external imports, house style
///         of the user's previous projects). Holders of a Binance .ai Agent
///         ID (SPACE ID NFT on BSC) can mint one Crown Race Pass: the first
///         500 are free (value 0, gas only), after that a pass costs exactly
///         0.0007 BNB. Pass holders boost their daily points with small,
///         repeatable BNB boosts; each UTC day the points leader is crowned
///         by the permissionless settleDay(), wins 50% of that day's boost
///         pool, and the other 50% is credited to the owner. No own token.
/// @dev Agent ID registry address is a constructor argument: on BNB Chain
///      mainnet deploy with 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
///      (the SPACE ID .ai NFT). This keeps mainnet behaviour exact while
///      letting local tests substitute a mock registry.
contract CrownRace {
    // ---------- ERC-721 metadata ----------
    string public name = "Crown Race Pass";
    string public symbol = "CROWN";

    // ---------- Ownership ----------
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ---------- Collection / mint state ----------
    uint256 public constant MAX_SUPPLY = 2222;
    uint256 public constant FREE_SUPPLY = 500;
    uint256 public constant PAID_PRICE = 0.0007 ether;
    uint256 public totalMinted; // also the last issued token ID (IDs sequential from 1)
    bool public mintOpen = false; // starts closed; the owner opens it with setMintOpen(true)

    /// @notice The Agent ID registry (.ai NFT) checked on every mint.
    address public immutable agentId;

    mapping(address => bool) public hasMinted; // a wallet may only ever MINT one pass
    string public baseURI;

    // ---------- Race state ----------
    uint256[3] public boostPrice; // wei, by tier 0/1/2
    uint256[3] public boostPoints; // points, by tier 0/1/2
    bool public boostPaused = false;

    mapping(uint256 => mapping(address => uint256)) public points; // points[day][wallet]
    mapping(uint256 => uint256) public dayPool; // boost wei collected on a day
    mapping(uint256 => address) public dayLeader; // points leader of a day
    mapping(uint256 => uint256) public dayLeaderPoints;
    mapping(uint256 => address) public kingOfDay; // settled winner of a day (0 = none)
    mapping(address => uint256) public crownsWon; // lifetime crowns per wallet

    /// @notice The most recent day that has been settled. Days are
    ///         block.timestamp / 86400 (UTC). Initialised to the day before
    ///         deployment so the deployment day itself is settleable once it
    ///         ends, and nothing before deployment can be settled.
    uint256 public lastSettledDay;

    /// @notice Owner's withdrawable balance: the owner's 50% share of settled
    ///         day pools plus all paid-pass revenue. Unsettled day pools are
    ///         NEVER part of this balance, so withdraw() cannot touch them.
    uint256 public ownerBalance;

    // ---------- ERC-721 storage ----------
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256) private _ownedIndex;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed tokenOwner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed tokenOwner, address indexed operator, bool approved);
    event PassMinted(address indexed to, uint256 indexed tokenId, bool paid);
    event Boosted(address indexed wallet, uint256 indexed day, uint8 tier, uint256 pointsAdded, uint256 totalPointsToday);
    event DaySettled(uint256 indexed day, address indexed winner, uint256 prize, uint256 ownerShare);
    event MintOpenSet(bool open);
    event BoostPausedSet(bool paused);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address agentId_) {
        require(agentId_ != address(0), "Zero address");
        owner = msg.sender;
        agentId = agentId_;
        lastSettledDay = _today() - 1;
        // Boost schedule: small, repeatable, prices locked at deployment.
        boostPrice[0] = 0.00015 ether; // Spark
        boostPrice[1] = 0.0005 ether; // Surge
        boostPrice[2] = 0.0015 ether; // Crown Rush
        boostPoints[0] = 5;
        boostPoints[1] = 20;
        boostPoints[2] = 75;
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / 86400;
    }

    function _hasAgentId(address wallet) internal view returns (bool) {
        return IAgentId(agentId).balanceOf(wallet) > 0;
    }

    // ---------- Minting ----------
    /// @notice Free pass mint. Only while the free supply lasts, value must
    ///         be exactly 0, one pass per wallet ever, Agent ID required.
    function mint() external payable returns (uint256 tokenId) {
        require(msg.value == 0, "Free mint is value 0");
        require(totalMinted < FREE_SUPPLY, "Free supply over, use mintPaid");
        tokenId = _mintPass(false);
    }

    /// @notice Paid pass mint at exactly 0.0007 BNB. Only available once the
    ///         free supply is exhausted. Revenue goes to the owner balance.
    function mintPaid() external payable returns (uint256 tokenId) {
        require(totalMinted >= FREE_SUPPLY, "Free passes remain");
        require(msg.value == PAID_PRICE, "Exact price required");
        tokenId = _mintPass(true);
        ownerBalance += msg.value;
    }

    function _mintPass(bool paid) internal returns (uint256 tokenId) {
        require(mintOpen, "Mint is closed");
        require(totalMinted < MAX_SUPPLY, "Sold out");
        require(_hasAgentId(msg.sender), "Agent ID required");
        require(!hasMinted[msg.sender], "One pass per wallet");
        require(_balances[msg.sender] == 0, "Already holds a pass");
        hasMinted[msg.sender] = true;
        tokenId = ++totalMinted;
        _owners[tokenId] = msg.sender;
        _balances[msg.sender] = 1;
        _ownedIndex[tokenId] = _ownedTokens[msg.sender].length;
        _ownedTokens[msg.sender].push(tokenId);
        emit Transfer(address(0), msg.sender, tokenId);
        emit PassMinted(msg.sender, tokenId, paid);
    }

    /// @notice The price of the next pass: 0 while free supply remains,
    ///         otherwise the paid price.
    function passPrice() external view returns (uint256) {
        return totalMinted < FREE_SUPPLY ? 0 : PAID_PRICE;
    }

    // ---------- The race ----------
    /// @notice Boost today's points. Pass holders only. Tier 0/1/2 cost
    ///         exactly 0.00015 / 0.0005 / 0.0015 BNB for +5 / +20 / +75
    ///         points. The full amount enters today's pool.
    function boost(uint8 tier) external payable {
        require(!boostPaused, "Boost paused");
        require(tier < 3, "Bad tier");
        require(msg.value == boostPrice[tier], "Exact price required");
        require(_balances[msg.sender] > 0, "Pass required");
        uint256 day = _today();
        uint256 total = points[day][msg.sender] + boostPoints[tier];
        points[day][msg.sender] = total;
        dayPool[day] += msg.value;
        // Strictly greater: on a tie the earlier achiever keeps the lead.
        if (total > dayLeaderPoints[day]) {
            dayLeader[day] = msg.sender;
            dayLeaderPoints[day] = total;
        }
        emit Boosted(msg.sender, day, tier, boostPoints[tier], total);
    }

    /// @notice Settle the oldest unsettled day once it has fully ended.
    ///         Permissionless — anyone can call it, the race never stalls.
    ///         The day's leader wins exactly 50% of that day's pool; the
    ///         rest is credited to the owner balance. A day with no boosts
    ///         settles cleanly with no winner and no payment.
    function settleDay() external {
        uint256 day = lastSettledDay + 1;
        require(day < _today(), "Day not ended");
        lastSettledDay = day;
        address winner = dayLeader[day];
        uint256 pool = dayPool[day];
        if (winner != address(0) && pool > 0) {
            uint256 prize = pool / 2;
            uint256 ownerShare = pool - prize;
            ownerBalance += ownerShare;
            crownsWon[winner] += 1;
            kingOfDay[day] = winner;
            emit DaySettled(day, winner, prize, ownerShare);
            (bool ok, ) = payable(winner).call{value: prize}("");
            require(ok, "Prize payment failed");
        } else {
            emit DaySettled(day, address(0), 0, 0);
        }
    }

    // ---------- Race views ----------
    function pointsOf(uint256 day, address wallet) external view returns (uint256) {
        return points[day][wallet];
    }

    /// @notice Current day's points leader (address(0) if nobody boosted yet).
    function leader() external view returns (address) {
        return dayLeader[_today()];
    }

    /// @notice Current day leader's points.
    function leaderPoints() external view returns (uint256) {
        return dayLeaderPoints[_today()];
    }

    /// @notice Boost wei collected so far today.
    function poolToday() external view returns (uint256) {
        return dayPool[_today()];
    }

    // ---------- Owner controls ----------
    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpenSet(open);
    }

    function setBoostPaused(bool paused) external onlyOwner {
        boostPaused = paused;
        emit BoostPausedSet(paused);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseURI = newBaseURI;
    }

    /// @notice Withdraw the owner balance only (settled owner shares + paid
    ///         pass revenue). Unsettled day pools are untouchable here.
    function withdraw() external onlyOwner {
        uint256 amount = ownerBalance;
        require(amount > 0, "Nothing to withdraw");
        ownerBalance = 0;
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(owner, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ---------- ERC-721 ----------
    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "Zero address");
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "Nonexistent token");
        return tokenOwner;
    }

    /// @notice All token IDs owned by an account, for site enumeration.
    function tokensOfOwner(address account) external view returns (uint256[] memory) {
        return _ownedTokens[account];
    }

    function approve(address approved, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(msg.sender == tokenOwner || _operatorApprovals[tokenOwner][msg.sender], "Not authorized");
        _tokenApprovals[tokenId] = approved;
        emit Approval(tokenOwner, approved, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(_owners[tokenId] != address(0), "Nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        require(_checkReceived(from, to, tokenId, ""), "Unsafe recipient");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        transferFrom(from, to, tokenId);
        require(_checkReceived(from, to, tokenId, data), "Unsafe recipient");
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0x01ffc9a7;
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf(tokenId);
        return spender == tokenOwner || spender == _tokenApprovals[tokenId] || _operatorApprovals[tokenOwner][spender];
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "Wrong owner");
        require(to != address(0), "Zero address");
        require(_balances[to] == 0, "Recipient already holds a pass");
        _tokenApprovals[tokenId] = address(0);
        emit Approval(from, address(0), tokenId);
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        uint256 idx = _ownedIndex[tokenId];
        uint256[] storage fromList = _ownedTokens[from];
        uint256 lastId = fromList[fromList.length - 1];
        fromList[idx] = lastId;
        _ownedIndex[lastId] = idx;
        fromList.pop();
        _ownedIndex[tokenId] = _ownedTokens[to].length;
        _ownedTokens[to].push(tokenId);
        emit Transfer(from, to, tokenId);
    }

    function _checkReceived(address from, address to, uint256 tokenId, bytes memory data) internal returns (bool) {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch {
            return false;
        }
    }

    // ---------- Metadata ----------
    /// @notice Off-chain JSON metadata: baseURI + tokenId + ".json"
    ///         (e.g. https://crownrace.fun/metadata/1.json). The site renders
    ///         the pass art; set baseURI with setBaseURI.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "Nonexistent token");
        return string(abi.encodePacked(baseURI, _toString(tokenId), ".json"));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

interface IAgentId {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}
