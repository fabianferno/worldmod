// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WMOD
 * @notice World Mod's native token. A minimal, self-contained ERC-20 — this
 *         repo vendors no OpenZeppelin, and the token needs nothing beyond the
 *         standard surface plus an owner mint for seeding the demo.
 *
 * The token exists to back one real function today: validator bonding (see
 * `ValidatorBond.sol`), where a validator stakes WMOD that is slashable for bad
 * validation. product-spec §16 is explicit that a token with no function is
 * vaporware; this one is wired to the validator flow that already exists, which
 * is what earns it an [MVP] label instead of [ROADMAP].
 */
contract WMOD {
    string public constant name = "World Mod";
    string public constant symbol = "WMOD";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnerSet(address indexed owner);

    error NotOwner();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        emit OwnerSet(msg.sender);
        if (initialSupply > 0) {
            totalSupply = initialSupply;
            balanceOf[msg.sender] = initialSupply;
            emit Transfer(address(0), msg.sender, initialSupply);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Seed supply for the demo. Owner-only; a production token would
    ///         cap or renounce this.
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
