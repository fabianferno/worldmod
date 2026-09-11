// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";
import {WMOD} from "../src/WMOD.sol";
import {ValidatorBond, IERC20} from "../src/ValidatorBond.sol";

contract WMODTest is Test {
    WMOD internal token;
    address internal deployer = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant SUPPLY = 1_000_000 ether;

    function setUp() public {
        token = new WMOD(SUPPLY);
    }

    function test_initialSupplyToDeployer() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(deployer), SUPPLY);
    }

    function test_transfer() public {
        token.transfer(alice, 100 ether);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(deployer), SUPPLY - 100 ether);
    }

    function test_transferInsufficientBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(WMOD.InsufficientBalance.selector);
        token.transfer(bob, 1 ether);
    }

    function test_approveAndTransferFrom() public {
        token.transfer(alice, 100 ether);
        vm.prank(alice);
        token.approve(bob, 40 ether);
        vm.prank(bob);
        token.transferFrom(alice, bob, 40 ether);
        assertEq(token.balanceOf(bob), 40 ether);
        assertEq(token.allowance(alice, bob), 0);
    }

    function test_infiniteAllowanceNotDecremented() public {
        token.transfer(alice, 100 ether);
        vm.prank(alice);
        token.approve(bob, type(uint256).max);
        vm.prank(bob);
        token.transferFrom(alice, bob, 40 ether);
        assertEq(token.allowance(alice, bob), type(uint256).max);
    }

    function test_transferFromInsufficientAllowanceReverts() public {
        token.transfer(alice, 100 ether);
        vm.prank(alice);
        token.approve(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(WMOD.InsufficientAllowance.selector);
        token.transferFrom(alice, bob, 40 ether);
    }

    function test_ownerMint() public {
        token.mint(alice, 5 ether);
        assertEq(token.balanceOf(alice), 5 ether);
        assertEq(token.totalSupply(), SUPPLY + 5 ether);
    }

    function test_nonOwnerMintReverts() public {
        vm.prank(alice);
        vm.expectRevert(WMOD.NotOwner.selector);
        token.mint(alice, 5 ether);
    }
}

contract ValidatorBondTest is Test {
    WMOD internal token;
    EntityRegistry internal entities;
    AssetRegistry internal assets;
    EpisodeRegistry internal registry;
    ValidatorBond internal bond;

    address internal deployer = address(this);
    address internal validator = address(0x5A1D);
    address internal slasher = address(0x5107);
    address internal outsider = address(0xDEAD);

    uint256 internal constant MIN_BOND = 100 ether;
    address internal constant BURN = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        token = new WMOD(1_000_000 ether);
        entities = new EntityRegistry();
        assets = new AssetRegistry(entities);
        registry = new EpisodeRegistry(assets);
        bond = new ValidatorBond(IERC20(address(token)), registry, slasher, MIN_BOND);

        // Fund the validator and let it stake.
        token.transfer(validator, 500 ether);
        vm.prank(validator);
        token.approve(address(bond), type(uint256).max);
    }

    function _bond(uint256 amount) internal {
        vm.prank(validator);
        bond.bond(amount);
    }

    function test_bondPullsTokensAndTracks() public {
        _bond(150 ether);
        assertEq(bond.bondOf(validator), 150 ether);
        assertEq(bond.totalBonded(), 150 ether);
        assertEq(token.balanceOf(address(bond)), 150 ether);
        assertEq(token.balanceOf(validator), 350 ether);
    }

    function test_isBondedThreshold() public {
        _bond(99 ether);
        assertFalse(bond.isBonded(validator));
        _bond(1 ether);
        assertTrue(bond.isBonded(validator));
    }

    function test_withdraw() public {
        _bond(200 ether);
        vm.prank(validator);
        bond.withdraw(50 ether);
        assertEq(bond.bondOf(validator), 150 ether);
        assertEq(token.balanceOf(validator), 350 ether);
    }

    function test_withdrawMoreThanBondReverts() public {
        _bond(100 ether);
        vm.prank(validator);
        vm.expectRevert(ValidatorBond.InsufficientBond.selector);
        bond.withdraw(101 ether);
    }

    function test_slasherBurnsStake() public {
        _bond(300 ether);
        vm.prank(slasher);
        bond.slash(validator, 120 ether);
        assertEq(bond.bondOf(validator), 180 ether);
        assertEq(bond.totalBonded(), 180 ether);
        assertEq(token.balanceOf(BURN), 120 ether);
    }

    function test_nonSlasherCannotSlash() public {
        _bond(300 ether);
        vm.prank(outsider);
        vm.expectRevert(ValidatorBond.NotSlasher.selector);
        bond.slash(validator, 10 ether);
    }

    function test_slashMoreThanBondReverts() public {
        _bond(50 ether);
        vm.prank(slasher);
        vm.expectRevert(ValidatorBond.InsufficientBond.selector);
        bond.slash(validator, 51 ether);
    }

    function test_isRegisteredValidatorReflectsRegistry() public {
        assertFalse(bond.isRegisteredValidator(validator));
        registry.setValidator(validator, true);
        assertTrue(bond.isRegisteredValidator(validator));
    }

    function test_onlyOwnerSetsSlasherAndMinBond() public {
        bond.setSlasher(outsider);
        assertEq(bond.slasher(), outsider);
        bond.setMinBond(5 ether);
        assertEq(bond.minBond(), 5 ether);

        vm.prank(outsider);
        vm.expectRevert(ValidatorBond.NotOwner.selector);
        bond.setMinBond(1 ether);
    }
}
