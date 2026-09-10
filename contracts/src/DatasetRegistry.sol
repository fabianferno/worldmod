// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EpisodeRegistry} from "./EpisodeRegistry.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title DatasetRegistry
 * @notice A dataset is a bundle of episode commitments plus its licensing terms.
 *
 * product-spec §11 calls this the RWA object, and the phrase is load-bearing:
 * what is sold is not the video. The bytes stay off-chain, exactly as §10.2
 * requires, and what lives here is the set of manifest hashes the bundle
 * covers, who may use them and on what terms. A buyer's licence is a receipt
 * against a specific, immutable list of episodes.
 *
 * Two properties the design turns on.
 *
 * **A dataset is immutable once minted.** Episodes cannot be added or removed
 * afterwards. A licence is priced against what was inspected, and a mutable
 * bundle would let a seller swap the contents after the sale — the same reason
 * EpisodeRegistry refuses to revise a validation.
 *
 * **Only episodes that were actually validated can be bundled.** §7 sells data
 * that passed the validator; letting an unvalidated episode into a dataset
 * would sell exactly what the plausibility check exists to keep out.
 *
 * Revenue splits back to contributors are deliberately NOT here. Paying the
 * right people requires knowing what each episode was worth to a model, which
 * is §8.3's utility measurement and lives in BountyEscrow.settleUtility.
 * Duplicating a weaker version of it here would be two answers to one question.
 */
contract DatasetRegistry {
    struct Dataset {
        address creator;
        uint96 priceUsdc;
        bytes32 episodesRoot;
        uint32 episodeCount;
        uint64 mintedAt;
        string license;
        string metadataURI;
    }

    IERC20Minimal public immutable token;
    EpisodeRegistry public immutable episodes;

    mapping(uint256 => Dataset) private _datasets;
    /// @dev Episode ids per dataset, in the order they were minted.
    mapping(uint256 => uint256[]) private _members;
    /// @dev datasetId => buyer => holds a licence.
    mapping(uint256 => mapping(address => bool)) public licensed;
    /// @dev Withdrawable proceeds, credited on purchase.
    mapping(address => uint256) public balanceOf;

    uint256 public datasetCount;

    /// @dev A bundle has to fit in one transaction to be mintable at all.
    uint256 private constant MAX_EPISODES = 500;

    event DatasetMinted(uint256 indexed datasetId, address indexed creator, uint32 episodeCount, bytes32 episodesRoot);
    event LicensePurchased(uint256 indexed datasetId, address indexed buyer, uint256 price);
    event Withdrawn(address indexed account, uint256 amount);

    error EmptyDataset();
    error TooManyEpisodes();
    error UnknownDataset();
    error UnknownEpisode();
    error EpisodeNotValidated();
    error DuplicateEpisode();
    error AlreadyLicensed();
    error TransferFailed();
    error NothingToWithdraw();
    error EmptyLicense();

    constructor(IERC20Minimal usdc, EpisodeRegistry episodeRegistry) {
        token = usdc;
        episodes = episodeRegistry;
    }

    function getDataset(uint256 datasetId) external view returns (Dataset memory) {
        if (datasetId == 0 || datasetId > datasetCount) revert UnknownDataset();
        return _datasets[datasetId];
    }

    /// @notice The episode ids this dataset covers.
    function membersOf(uint256 datasetId) external view returns (uint256[] memory) {
        if (datasetId == 0 || datasetId > datasetCount) revert UnknownDataset();
        return _members[datasetId];
    }

    /**
     * @notice Bundle validated episodes into a licensable dataset.
     * @param episodeIds The episodes covered. Must each carry a validation.
     * @param license A licence identifier; §7 ships one, commercial training.
     * @dev The returned root commits to the exact membership, so a licence can
     *      be checked against the bundle without reading the whole list back.
     */
    function mintDataset(
        uint256[] calldata episodeIds,
        uint96 priceUsdc,
        string calldata license,
        string calldata metadataURI
    ) external returns (uint256 datasetId) {
        if (episodeIds.length == 0) revert EmptyDataset();
        if (episodeIds.length > MAX_EPISODES) revert TooManyEpisodes();
        if (bytes(license).length == 0) revert EmptyLicense();

        // Sorted-strictly-ascending doubles as the duplicate check, which
        // avoids a second pass and an O(n^2) scan.
        uint256 previous;
        for (uint256 i = 0; i < episodeIds.length; i++) {
            uint256 id = episodeIds[i];
            if (i > 0 && id <= previous) revert DuplicateEpisode();
            previous = id;

            if (id == 0 || id > episodes.episodeCount()) revert UnknownEpisode();
            if (!episodes.getValidation(id).recorded) revert EpisodeNotValidated();
        }

        datasetId = ++datasetCount;
        _members[datasetId] = episodeIds;

        _datasets[datasetId] = Dataset({
            creator: msg.sender,
            priceUsdc: priceUsdc,
            episodesRoot: keccak256(abi.encodePacked(episodeIds)),
            episodeCount: uint32(episodeIds.length),
            mintedAt: uint64(block.timestamp),
            license: license,
            metadataURI: metadataURI
        });

        emit DatasetMinted(datasetId, msg.sender, uint32(episodeIds.length), _datasets[datasetId].episodesRoot);
    }

    /**
     * @notice Buy a licence to a dataset.
     * @dev Proceeds are credited, not pushed: a creator with a reverting
     *      fallback would otherwise make their own dataset unbuyable.
     */
    function purchaseLicense(uint256 datasetId) external {
        if (datasetId == 0 || datasetId > datasetCount) revert UnknownDataset();
        if (licensed[datasetId][msg.sender]) revert AlreadyLicensed();

        Dataset storage dataset = _datasets[datasetId];
        licensed[datasetId][msg.sender] = true;

        uint256 price = dataset.priceUsdc;
        if (price > 0) {
            balanceOf[dataset.creator] += price;
            if (!token.transferFrom(msg.sender, address(this), price)) revert TransferFailed();
        }

        emit LicensePurchased(datasetId, msg.sender, price);
    }

    function withdraw() external {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        balanceOf[msg.sender] = 0;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }
}
