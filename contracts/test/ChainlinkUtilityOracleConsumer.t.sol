// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainlinkUtilityOracleConsumer, IReceiver, IBountyEscrow} from "../src/ChainlinkUtilityOracleConsumer.sol";

/// @dev Captures the last settleUtility call so the consumer can be tested in
///      isolation from BountyEscrow's (separately fork-tested) payout logic.
contract MockEscrow is IBountyEscrow {
    bytes32 public lastBountyId;
    address[] public lastContributors;
    uint32[] public lastShares;
    uint256 public calls;

    function settleUtility(bytes32 bountyId, address[] calldata contributors, uint32[] calldata sharesBps)
        external
        override
    {
        lastBountyId = bountyId;
        lastContributors = contributors;
        lastShares = sharesBps;
        calls++;
    }

    function contributorsLength() external view returns (uint256) {
        return lastContributors.length;
    }
}

contract ChainlinkUtilityOracleConsumerTest is Test {
    MockEscrow internal escrow;
    ChainlinkUtilityOracleConsumer internal consumer;

    address internal forwarder = address(0xF0F0);
    address internal altForwarder = address(0xA17E);
    address internal outsider = address(0xDEAD);

    bytes32 internal constant BOUNTY = keccak256("bounty_keyboard_001");

    function setUp() public {
        escrow = new MockEscrow();
        consumer = new ChainlinkUtilityOracleConsumer(IBountyEscrow(address(escrow)), forwarder, altForwarder);
    }

    function _report(bytes32 bountyId, address[] memory contributors, uint32[] memory sharesBps)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(bountyId, contributors, sharesBps);
    }

    function _twoWay() internal pure returns (address[] memory c, uint32[] memory s) {
        c = new address[](2);
        c[0] = address(0xC0);
        c[1] = address(0xC1);
        s = new uint32[](2);
        s[0] = 8623;
        s[1] = 1377;
    }

    function test_forwarderReportSettlesUtility() public {
        (address[] memory c, uint32[] memory s) = _twoWay();
        vm.prank(forwarder);
        consumer.onReport("", _report(BOUNTY, c, s));

        assertEq(escrow.calls(), 1);
        assertEq(escrow.lastBountyId(), BOUNTY);
        assertEq(escrow.contributorsLength(), 2);
        assertEq(escrow.lastContributors(0), address(0xC0));
        assertEq(escrow.lastShares(1), 1377);
    }

    function test_altForwarderReportSettlesUtility() public {
        (address[] memory c, uint32[] memory s) = _twoWay();
        vm.prank(altForwarder);
        consumer.onReport("", _report(BOUNTY, c, s));
        assertEq(escrow.calls(), 1);
    }

    function test_rejectsReportFromNonForwarder() public {
        (address[] memory c, uint32[] memory s) = _twoWay();
        vm.prank(outsider);
        vm.expectRevert(ChainlinkUtilityOracleConsumer.NotForwarder.selector);
        consumer.onReport("", _report(BOUNTY, c, s));
        assertEq(escrow.calls(), 0);
    }

    function test_zeroAltForwarderNeverAuthorizes() public {
        ChainlinkUtilityOracleConsumer solo =
            new ChainlinkUtilityOracleConsumer(IBountyEscrow(address(escrow)), forwarder, address(0));
        (address[] memory c, uint32[] memory s) = _twoWay();
        vm.prank(address(0));
        vm.expectRevert(ChainlinkUtilityOracleConsumer.NotForwarder.selector);
        solo.onReport("", _report(BOUNTY, c, s));
    }

    function test_ownerCanRotateForwarder() public {
        address newForwarder = address(0xF00D);
        consumer.setForwarder(newForwarder);
        (address[] memory c, uint32[] memory s) = _twoWay();

        vm.prank(forwarder);
        vm.expectRevert(ChainlinkUtilityOracleConsumer.NotForwarder.selector);
        consumer.onReport("", _report(BOUNTY, c, s));

        vm.prank(newForwarder);
        consumer.onReport("", _report(BOUNTY, c, s));
        assertEq(escrow.calls(), 1);
    }

    function test_ownerCanRotateAltForwarder() public {
        address newAlt = address(0xBEEF);
        consumer.setAltForwarder(newAlt);
        (address[] memory c, uint32[] memory s) = _twoWay();

        vm.prank(newAlt);
        consumer.onReport("", _report(BOUNTY, c, s));
        assertEq(escrow.calls(), 1);
    }

    function test_nonOwnerCannotRotateForwarder() public {
        vm.prank(outsider);
        vm.expectRevert(ChainlinkUtilityOracleConsumer.NotOwner.selector);
        consumer.setForwarder(outsider);
    }

    function test_nonOwnerCannotRotateAltForwarder() public {
        vm.prank(outsider);
        vm.expectRevert(ChainlinkUtilityOracleConsumer.NotOwner.selector);
        consumer.setAltForwarder(outsider);
    }

    function test_supportsInterface() public view {
        assertTrue(consumer.supportsInterface(type(IReceiver).interfaceId));
        assertFalse(consumer.supportsInterface(bytes4(0xdeadbeef)));
    }
}
