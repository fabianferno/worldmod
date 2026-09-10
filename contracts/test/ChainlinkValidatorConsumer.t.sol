// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";
import {ChainlinkValidatorConsumer, IReceiver} from "../src/ChainlinkValidatorConsumer.sol";

contract ChainlinkValidatorConsumerTest is Test {
    EntityRegistry internal entities;
    AssetRegistry internal assets;
    EpisodeRegistry internal episodes;
    ChainlinkValidatorConsumer internal consumer;

    uint256 internal contributorKey = 0xA11CE;
    address internal contributor;
    address internal forwarder = address(0xF0F0);
    address internal altForwarder = address(0xA17E);
    address internal outsider = address(0xDEAD);

    uint256 internal assetId;
    uint256 internal episodeId;
    bytes32 internal constant BOUNTY = keccak256("bounty_keyboard_001");
    bytes32 internal constant MANIFEST = keccak256("manifest-one");

    function setUp() public {
        contributor = vm.addr(contributorKey);

        entities = new EntityRegistry();
        assets = new AssetRegistry(entities);
        episodes = new EpisodeRegistry(assets);
        consumer = new ChainlinkValidatorConsumer(episodes, forwarder, altForwarder);
        episodes.setValidator(address(consumer), true);

        vm.startPrank(contributor);
        entities.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://who");
        assetId = assets.registerAsset("phone", assets.MODALITY_RGB() | assets.MODALITY_IMU(), "ipfs://capabilities");
        episodeId = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");
        vm.stopPrank();
    }

    function _report(uint256 episode_, uint16 score, uint8 trustLevel) internal pure returns (bytes memory) {
        return abi.encode(episode_, score, trustLevel);
    }

    function test_forwarderReportRecordsValidation() public {
        vm.prank(forwarder);
        consumer.onReport("", _report(episodeId, 9000, uint8(EpisodeRegistry.TrustLevel.Heuristic)));

        EpisodeRegistry.Validation memory v = episodes.getValidation(episodeId);
        assertEq(v.score, 9000);
        assertEq(uint8(v.trustLevel), uint8(EpisodeRegistry.TrustLevel.Heuristic));
        assertEq(v.validator, address(consumer));
        assertTrue(v.recorded);
    }

    function test_rejectsReportFromNonForwarder() public {
        vm.prank(outsider);
        vm.expectRevert(ChainlinkValidatorConsumer.NotForwarder.selector);
        consumer.onReport("", _report(episodeId, 9000, 0));
    }

    function test_ownerCanRotateForwarder() public {
        address newForwarder = address(0xF00D);
        consumer.setForwarder(newForwarder);

        vm.prank(forwarder);
        vm.expectRevert(ChainlinkValidatorConsumer.NotForwarder.selector);
        consumer.onReport("", _report(episodeId, 9000, 0));

        vm.prank(newForwarder);
        consumer.onReport("", _report(episodeId, 9000, 0));
        assertTrue(episodes.getValidation(episodeId).recorded);
    }

    function test_nonOwnerCannotRotateForwarder() public {
        vm.prank(outsider);
        vm.expectRevert(ChainlinkValidatorConsumer.NotOwner.selector);
        consumer.setForwarder(outsider);
    }

    function test_altForwarderReportRecordsValidation() public {
        vm.prank(altForwarder);
        consumer.onReport("", _report(episodeId, 8000, uint8(EpisodeRegistry.TrustLevel.Heuristic)));

        EpisodeRegistry.Validation memory v = episodes.getValidation(episodeId);
        assertEq(v.score, 8000);
        assertTrue(v.recorded);
    }

    function test_ownerCanRotateAltForwarder() public {
        address newAlt = address(0xBEEF);
        consumer.setAltForwarder(newAlt);

        vm.prank(altForwarder);
        vm.expectRevert(ChainlinkValidatorConsumer.NotForwarder.selector);
        consumer.onReport("", _report(episodeId, 9000, 0));

        vm.prank(newAlt);
        consumer.onReport("", _report(episodeId, 9000, 0));
        assertTrue(episodes.getValidation(episodeId).recorded);
    }

    function test_zeroAltForwarderNeverAuthorizes() public {
        // A consumer with no alternate forwarder must not let address(0) — or
        // anyone spoofing an unset slot — deliver a report.
        ChainlinkValidatorConsumer solo = new ChainlinkValidatorConsumer(episodes, forwarder, address(0));
        episodes.setValidator(address(solo), true);

        vm.prank(address(0));
        vm.expectRevert(ChainlinkValidatorConsumer.NotForwarder.selector);
        solo.onReport("", _report(episodeId, 9000, 0));
    }

    function test_nonOwnerCannotRotateAltForwarder() public {
        vm.prank(outsider);
        vm.expectRevert(ChainlinkValidatorConsumer.NotOwner.selector);
        consumer.setAltForwarder(outsider);
    }

    function test_supportsInterface() public view {
        assertTrue(consumer.supportsInterface(type(IReceiver).interfaceId));
        assertFalse(consumer.supportsInterface(bytes4(0xdeadbeef)));
    }
}
