// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EpisodeRegistry} from "./EpisodeRegistry.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title ValidatorBond
 * @notice The one real function behind WMOD: a validator stakes WMOD here, and
 *         a slasher can burn part of that stake for bad validation. This wires
 *         the token to something that already exists — the `EpisodeRegistry`
 *         validator set — rather than minting an empty token.
 *
 * `isBonded(v)` lets the rest of the system treat a validator's economic stake
 * as a gate: the registry's `recordValidation` path can, as a next step, refuse
 * an unbonded validator. The slasher is the same authority that manages
 * validators (the registry owner), so the power to punish sits with the power
 * to admit — not with this contract.
 *
 * Slashed stake is burned (sent to address-dead) rather than paid to the
 * slasher, so slashing can never be a profit motive.
 */
contract ValidatorBond {
    IERC20 public immutable token;
    EpisodeRegistry public immutable registry;

    address public owner;
    /// @dev Allowed to slash — set to the registry owner at deploy.
    address public slasher;
    uint256 public minBond;
    uint256 public totalBonded;

    mapping(address => uint256) public bondOf;

    /// @dev Burned stake goes here; balances at this address are unrecoverable.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    event Bonded(address indexed validator, uint256 amount, uint256 newBond);
    event Withdrawn(address indexed validator, uint256 amount, uint256 newBond);
    event Slashed(address indexed validator, uint256 amount, uint256 newBond);
    event SlasherSet(address indexed slasher);
    event MinBondSet(uint256 minBond);

    error NotOwner();
    error NotSlasher();
    error ZeroAmount();
    error InsufficientBond();

    constructor(IERC20 bondToken, EpisodeRegistry episodeRegistry, address slasherAddress, uint256 minBondAmount) {
        token = bondToken;
        registry = episodeRegistry;
        owner = msg.sender;
        slasher = slasherAddress;
        minBond = minBondAmount;
        emit SlasherSet(slasherAddress);
        emit MinBondSet(minBondAmount);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setSlasher(address slasherAddress) external onlyOwner {
        slasher = slasherAddress;
        emit SlasherSet(slasherAddress);
    }

    function setMinBond(uint256 minBondAmount) external onlyOwner {
        minBond = minBondAmount;
        emit MinBondSet(minBondAmount);
    }

    /// @notice Stake WMOD. Caller must have approved this contract first.
    function bond(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        // Pull first; balances update only if the transfer succeeds.
        token.transferFrom(msg.sender, address(this), amount);
        uint256 newBond = bondOf[msg.sender] + amount;
        bondOf[msg.sender] = newBond;
        totalBonded += amount;
        emit Bonded(msg.sender, amount, newBond);
    }

    /// @notice Withdraw part or all of your own stake.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 current = bondOf[msg.sender];
        if (current < amount) revert InsufficientBond();
        uint256 newBond = current - amount;
        bondOf[msg.sender] = newBond;
        totalBonded -= amount;
        token.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, newBond);
    }

    /// @notice Burn part of a validator's stake for bad validation. Slasher-only.
    function slash(address validator, uint256 amount) external {
        if (msg.sender != slasher) revert NotSlasher();
        if (amount == 0) revert ZeroAmount();
        uint256 current = bondOf[validator];
        if (current < amount) revert InsufficientBond();
        uint256 newBond = current - amount;
        bondOf[validator] = newBond;
        totalBonded -= amount;
        token.transfer(BURN, amount);
        emit Slashed(validator, amount, newBond);
    }

    /// @notice Whether a validator's stake clears the minimum bond.
    function isBonded(address validator) external view returns (bool) {
        return bondOf[validator] >= minBond;
    }

    /// @notice Cross-check: is this address an EpisodeRegistry validator?
    function isRegisteredValidator(address validator) external view returns (bool) {
        return registry.isValidator(validator);
    }
}
