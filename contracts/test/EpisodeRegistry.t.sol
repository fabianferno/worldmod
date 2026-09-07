// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";
import {Relayable} from "../src/Relayable.sol";

contract EpisodeRegistryTest is Test {
    EntityRegistry internal entities;
    AssetRegistry internal assets;
    EpisodeRegistry internal episodes;

    uint256 internal contributorKey = 0xA11CE;
    address internal contributor;
    address internal relayer = address(0xBEEF);
    address internal validator = address(0xDA7A);
    address internal outsider = address(0xDEAD);

    uint256 internal assetId;
    bytes32 internal constant BOUNTY = keccak256("bounty_keyboard_001");
    bytes32 internal constant MANIFEST = keccak256("manifest-one");

    bytes32 private constant SUBMIT_TYPEHASH = keccak256(
        "SubmitEpisode(uint256 assetId,bytes32 bountyId,bytes32 manifestHash,string storageURI,uint256 nonce)"
    );

    function setUp() public {
        contributor = vm.addr(contributorKey);

        entities = new EntityRegistry();
        assets = new AssetRegistry(entities);
        episodes = new EpisodeRegistry(assets);
        episodes.setValidator(validator, true);

        vm.startPrank(contributor);
        entities.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://who");
        assetId = assets.registerAsset(
            "phone", assets.MODALITY_RGB() | assets.MODALITY_IMU(), "ipfs://capabilities"
        );
        vm.stopPrank();
    }

    function _signSubmit(uint256 key, uint256 asset_, bytes32 bounty, bytes32 manifest, string memory uri, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(SUBMIT_TYPEHASH, asset_, bounty, manifest, keccak256(bytes(uri)), nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", episodes.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_submitsEpisode() public {
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        EpisodeRegistry.Episode memory episode = episodes.getEpisode(id);
        assertEq(episode.contributor, contributor);
        assertEq(episode.manifestHash, MANIFEST);
        assertEq(episodes.episodeByManifest(MANIFEST), id);
    }

    function test_relayedSubmissionAttributesToSigner() public {
        // The phone signs the manifest hash it computed before any byte left the
        // device, and never holds gas.
        bytes memory signature = _signSubmit(contributorKey, assetId, BOUNTY, MANIFEST, "s3://ep/1", 0);

        vm.prank(relayer);
        uint256 id = episodes.submitEpisodeFor(contributor, assetId, BOUNTY, MANIFEST, "s3://ep/1", signature);

        assertEq(episodes.getEpisode(id).contributor, contributor);
    }

    function test_relayerCannotSwapTheManifestHash() public {
        // The attack that would break the whole commitment: a relayer that can
        // substitute a different hash could attribute other footage to a
        // contributor, or launder its own.
        bytes memory signature = _signSubmit(contributorKey, assetId, BOUNTY, MANIFEST, "s3://ep/1", 0);

        vm.prank(relayer);
        vm.expectRevert(Relayable.InvalidSignature.selector);
        episodes.submitEpisodeFor(
            contributor, assetId, BOUNTY, keccak256("other-manifest"), "s3://ep/1", signature
        );
    }

    function test_relayerCannotRedirectStorage() public {
        bytes memory signature = _signSubmit(contributorKey, assetId, BOUNTY, MANIFEST, "s3://ep/1", 0);

        vm.expectRevert(Relayable.InvalidSignature.selector);
        episodes.submitEpisodeFor(contributor, assetId, BOUNTY, MANIFEST, "s3://attacker", signature);
    }

    function test_rejectsSubmissionForSomeoneElsesAsset() public {
        vm.prank(outsider);
        vm.expectRevert(EpisodeRegistry.NotAssetOwner.selector);
        episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");
    }

    function test_rejectsDuplicateManifest() public {
        vm.startPrank(contributor);
        episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        // The same footage submitted twice is one contribution, not two.
        vm.expectRevert(EpisodeRegistry.DuplicateManifest.selector);
        episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/2");
        vm.stopPrank();
    }

    function test_rejectsEmptyManifestHash() public {
        vm.prank(contributor);
        vm.expectRevert(EpisodeRegistry.EmptyManifestHash.selector);
        episodes.submitEpisode(assetId, BOUNTY, bytes32(0), "s3://ep/1");
    }

    function test_rejectsUnknownAsset() public {
        vm.prank(contributor);
        vm.expectRevert(AssetRegistry.UnknownAsset.selector);
        episodes.submitEpisode(999, BOUNTY, MANIFEST, "s3://ep/1");
    }

    function test_recordsValidation() public {
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        vm.prank(validator);
        episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);

        EpisodeRegistry.Validation memory result = episodes.getValidation(id);
        assertEq(result.score, 8310);
        assertEq(uint8(result.trustLevel), uint8(EpisodeRegistry.TrustLevel.Heuristic));
        assertEq(result.validator, validator);
        assertTrue(result.recorded);
    }

    function test_onlyValidatorCanRecord() public {
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        // A contributor scoring their own episode is the obvious attack.
        vm.prank(contributor);
        vm.expectRevert(EpisodeRegistry.NotValidator.selector);
        episodes.recordValidation(id, 10_000, EpisodeRegistry.TrustLevel.Hardware);
    }

    function test_validationIsImmutable() public {
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        vm.startPrank(validator);
        episodes.recordValidation(id, 5000, EpisodeRegistry.TrustLevel.Heuristic);

        // Payments settle against this score; one that can be revised is one a
        // buyer cannot rely on.
        vm.expectRevert(EpisodeRegistry.AlreadyValidated.selector);
        episodes.recordValidation(id, 9000, EpisodeRegistry.TrustLevel.Heuristic);
        vm.stopPrank();
    }

    function test_rejectsScoreAboveRange() public {
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        vm.prank(validator);
        vm.expectRevert(EpisodeRegistry.ScoreOutOfRange.selector);
        episodes.recordValidation(id, 10_001, EpisodeRegistry.TrustLevel.Heuristic);
    }

    function test_validatorRoleIsRevocable() public {
        episodes.setValidator(validator, false);

        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, MANIFEST, "s3://ep/1");

        vm.prank(validator);
        vm.expectRevert(EpisodeRegistry.NotValidator.selector);
        episodes.recordValidation(id, 5000, EpisodeRegistry.TrustLevel.Heuristic);
    }

    function test_onlyOwnerManagesValidators() public {
        vm.prank(outsider);
        vm.expectRevert(EpisodeRegistry.NotOwner.selector);
        episodes.setValidator(outsider, true);
    }

    function test_unknownEpisodeReverts() public {
        vm.expectRevert(EpisodeRegistry.UnknownEpisode.selector);
        episodes.getEpisode(42);
    }
}
