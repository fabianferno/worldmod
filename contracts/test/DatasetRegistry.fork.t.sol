// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {DatasetRegistry, IERC20Minimal} from "../src/DatasetRegistry.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/**
 * A dataset is what a buyer actually pays for, so these run against Circle's
 * real USDC for the same reason the escrow tests do.
 */
contract DatasetRegistryForkTest is Test {
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 internal constant BASE_SEPOLIA = 84532;

    EntityRegistry internal entities;
    AssetRegistry internal assets;
    EpisodeRegistry internal episodes;
    DatasetRegistry internal datasets;

    address internal creator = address(0xC2EA);
    address internal buyer = address(0xB0B);
    address internal contributor = address(0xC0FFEE);
    address internal validator = address(0xDA7A);

    uint256 internal assetId;
    uint96 internal constant PRICE = 25_000_000; // 25 USDC

    bool internal forked;

    function setUp() public {
        try vm.envString("BASE_SEPOLIA_RPC_URL") returns (string memory url) {
            vm.createSelectFork(url);
            forked = block.chainid == BASE_SEPOLIA;
        } catch {
            forked = false;
        }
        if (!forked) return;

        entities = new EntityRegistry();
        assets = new AssetRegistry(entities);
        episodes = new EpisodeRegistry(assets);
        datasets = new DatasetRegistry(IERC20Minimal(USDC), episodes);
        episodes.setValidator(validator, true);

        vm.startPrank(contributor);
        entities.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://who");
        assetId = assets.registerAsset("phone", assets.MODALITY_RGB() | assets.MODALITY_IMU(), "ipfs://cap");
        vm.stopPrank();

        deal(USDC, buyer, 1_000_000_000, true);
        vm.prank(buyer);
        (bool ok,) =
            USDC.call(abi.encodeWithSignature("approve(address,uint256)", address(datasets), type(uint256).max));
        require(ok, "approve failed");
    }

    modifier onlyForked() {
        if (!forked) return;
        _;
    }

    function _validatedEpisode(bytes32 manifest) internal returns (uint256 id) {
        vm.prank(contributor);
        id = episodes.submitEpisode(assetId, bytes32("b"), manifest, "s3://ep");
        vm.prank(validator);
        episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);
    }

    function _threeEpisodes() internal returns (uint256[] memory ids) {
        ids = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            ids[i] = _validatedEpisode(keccak256(abi.encode("m", i)));
        }
    }

    function test_mintsADatasetOverValidatedEpisodes() public onlyForked {
        uint256[] memory ids = _threeEpisodes();

        vm.prank(creator);
        uint256 datasetId = datasets.mintDataset(ids, PRICE, "commercial_ai_training", "ipfs://ds");

        DatasetRegistry.Dataset memory dataset = datasets.getDataset(datasetId);
        assertEq(dataset.creator, creator);
        assertEq(dataset.episodeCount, 3);
        assertEq(dataset.license, "commercial_ai_training");
        assertEq(dataset.episodesRoot, keccak256(abi.encodePacked(ids)));
        assertEq(datasets.membersOf(datasetId).length, 3);
    }

    function test_refusesAnEpisodeNobodyValidated() public onlyForked {
        // §7 sells data that passed the validator. Bundling an unchecked
        // episode would sell exactly what the plausibility check exists to
        // keep out.
        vm.prank(contributor);
        uint256 unchecked_ = episodes.submitEpisode(assetId, bytes32("b"), keccak256("raw"), "s3://ep");

        uint256[] memory ids = new uint256[](1);
        ids[0] = unchecked_;

        vm.prank(creator);
        vm.expectRevert(DatasetRegistry.EpisodeNotValidated.selector);
        datasets.mintDataset(ids, PRICE, "commercial_ai_training", "ipfs://ds");
    }

    function test_refusesTheSameEpisodeTwiceInOneDataset() public onlyForked {
        uint256 id = _validatedEpisode(keccak256("solo"));
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = id; // Would inflate the count a buyer prices against.

        vm.prank(creator);
        vm.expectRevert(DatasetRegistry.DuplicateEpisode.selector);
        datasets.mintDataset(ids, PRICE, "commercial_ai_training", "ipfs://ds");
    }

    function test_refusesAnEmptyDatasetAndAnEmptyLicense() public onlyForked {
        uint256[] memory none = new uint256[](0);
        vm.prank(creator);
        vm.expectRevert(DatasetRegistry.EmptyDataset.selector);
        datasets.mintDataset(none, PRICE, "commercial_ai_training", "ipfs://ds");

        uint256[] memory ids = _threeEpisodes();
        vm.prank(creator);
        vm.expectRevert(DatasetRegistry.EmptyLicense.selector);
        datasets.mintDataset(ids, PRICE, "", "ipfs://ds");
    }

    function test_sellsALicenceAndCreditsTheCreator() public onlyForked {
        uint256[] memory ids = _threeEpisodes();
        vm.prank(creator);
        uint256 datasetId = datasets.mintDataset(ids, PRICE, "commercial_ai_training", "ipfs://ds");

        assertFalse(datasets.licensed(datasetId, buyer));

        vm.prank(buyer);
        datasets.purchaseLicense(datasetId);

        assertTrue(datasets.licensed(datasetId, buyer));
        assertEq(datasets.balanceOf(creator), PRICE);

        uint256 before = _usdc(creator);
        vm.prank(creator);
        datasets.withdraw();
        assertEq(_usdc(creator) - before, PRICE);
    }

    function test_refusesToSellTheSameLicenceTwice() public onlyForked {
        uint256[] memory ids = _threeEpisodes();
        vm.prank(creator);
        uint256 datasetId = datasets.mintDataset(ids, PRICE, "commercial_ai_training", "ipfs://ds");

        vm.prank(buyer);
        datasets.purchaseLicense(datasetId);

        vm.prank(buyer);
        vm.expectRevert(DatasetRegistry.AlreadyLicensed.selector);
        datasets.purchaseLicense(datasetId);
    }

    function test_membershipCannotChangeAfterMinting() public onlyForked {
        // The whole point of the root: a licence is priced against what was
        // inspected, so there is no path that alters the bundle afterwards.
        uint256[] memory ids = _threeEpisodes();
        vm.prank(creator);
        uint256 datasetId = datasets.mintDataset(ids, PRICE, "commercial_ai_training", "ipfs://ds");

        bytes32 root = datasets.getDataset(datasetId).episodesRoot;
        _validatedEpisode(keccak256("later"));

        assertEq(datasets.getDataset(datasetId).episodesRoot, root);
        assertEq(datasets.membersOf(datasetId).length, 3);
    }

    function _usdc(address who) internal view returns (uint256) {
        (, bytes memory data) = USDC.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        return abi.decode(data, (uint256));
    }
}
