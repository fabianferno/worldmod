// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {BountyEscrow, IERC20} from "../src/BountyEscrow.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/**
 * Escrow tests against the real USDC on Base Sepolia.
 *
 * A mock would have hidden the two behaviours that actually matter here.
 * Circle's token REVERTS on insufficient balance or allowance rather than
 * returning false, so the `if (!transfer(...))` guard is a backstop and not the
 * real failure path — a mock that politely returned false would have suggested
 * otherwise. It is also an upgradeable proxy, so storage layout and gas cost
 * differ from any hand-written stand-in.
 *
 * These tests need a fork and are skipped without one, so the suite still runs
 * offline; they are the ones that count before a deploy.
 */
contract BountyEscrowForkTest is Test {
    /// @dev Circle's official USDC on Base Sepolia.
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 internal constant BASE_SEPOLIA = 84532;

    IERC20 internal usdc = IERC20(USDC);
    EntityRegistry internal entities;
    AssetRegistry internal assets;
    EpisodeRegistry internal episodes;
    BountyEscrow internal escrow;

    address internal buyer = address(0xB0B);
    address internal contributor = address(0xC0FFEE);
    address internal validator = address(0xDA7A);

    uint256 internal assetId;
    bytes32 internal constant BOUNTY = keccak256("bounty_keyboard_001");

    /// @dev 100 USDC at 6 decimals: 60 to contributors, 30 pool, 5 validator, 5 treasury.
    uint96 internal constant BUDGET = 100_000_000;
    uint96 internal constant PER_EPISODE = 600_000;
    uint32 internal constant MAX_EPISODES = 100;
    uint96 internal constant POOL = 30_000_000;
    uint96 internal constant VALIDATOR_FEE = 5_000_000;
    uint96 internal constant TREASURY_FEE = 5_000_000;

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
        escrow = new BountyEscrow(usdc, episodes);
        episodes.setValidator(validator, true);

        vm.startPrank(contributor);
        entities.registerEntity(EntityRegistry.EntityType.Individual, "ipfs://who");
        assetId = assets.registerAsset("phone", assets.MODALITY_RGB() | assets.MODALITY_IMU(), "ipfs://cap");
        vm.stopPrank();

        // Real token, balance written directly rather than begged from a faucet.
        deal(USDC, buyer, 1_000_000_000, true);
        vm.prank(buyer);
        (bool ok,) = USDC.call(abi.encodeWithSignature("approve(address,uint256)", address(escrow), type(uint256).max));
        require(ok, "approve failed");
    }

    modifier onlyForked() {
        if (!forked) return;
        _;
    }

    function _createBounty() internal {
        vm.prank(buyer);
        escrow.createBounty(
            BOUNTY, BUDGET, PER_EPISODE, MAX_EPISODES, POOL, VALIDATOR_FEE, TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function _submitAndValidate(bytes32 manifest) internal returns (uint256 id) {
        vm.prank(contributor);
        id = episodes.submitEpisode(assetId, BOUNTY, manifest, "s3://ep");
        vm.prank(validator);
        episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);
    }

    function test_forkIsBaseSepoliaWithRealUSDC() public onlyForked {
        assertEq(block.chainid, BASE_SEPOLIA);
        (, bytes memory data) = USDC.staticcall(abi.encodeWithSignature("decimals()"));
        assertEq(abi.decode(data, (uint8)), 6);
    }

    function test_createsBountyAndEscrowsRealUSDC() public onlyForked {
        _createBounty();
        assertEq(usdc.balanceOf(address(escrow)), BUDGET);
        assertEq(escrow.getBounty(BOUNTY).buyer, buyer);
    }

    function test_rejectsBountyWhoseAllocationsExceedItsBudget() public onlyForked {
        // product-spec §7's own example: a 40 USDC pool alongside 100 x 0.60 in
        // per-episode payments against a 100 USDC budget, leaving nothing for
        // the fees §13 allocates. The escrow would run dry mid-bounty.
        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.BudgetMismatch.selector);
        escrow.createBounty(
            BOUNTY, BUDGET, PER_EPISODE, MAX_EPISODES, 40_000_000, VALIDATOR_FEE, TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function test_rejectsBountyThatUnderspendsItsBudget() public onlyForked {
        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.BudgetMismatch.selector);
        escrow.createBounty(
            BOUNTY, BUDGET, PER_EPISODE, MAX_EPISODES, 10_000_000, VALIDATOR_FEE, TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function test_contributorIsPaidInRealUSDC() public onlyForked {
        _createBounty();
        uint256 id = _submitAndValidate(keccak256("m1"));

        // Balances are measured as deltas. On a real chain an address has
        // history: 0xC0FFEE already holds USDC on Base Sepolia, and asserting
        // an absolute balance assumed a clean slate that does not exist.
        uint256 before = usdc.balanceOf(contributor);

        vm.prank(buyer);
        escrow.acceptEpisode(BOUNTY, id);
        assertEq(escrow.balanceOf(contributor), PER_EPISODE);

        vm.prank(contributor);
        escrow.withdraw();

        assertEq(usdc.balanceOf(contributor) - before, PER_EPISODE);
        assertEq(escrow.balanceOf(contributor), 0);
    }

    function test_refusesToPayAnUnvalidatedEpisode() public onlyForked {
        _createBounty();
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, BOUNTY, keccak256("m1"), "s3://ep");

        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.EpisodeNotValidated.selector);
        escrow.acceptEpisode(BOUNTY, id);
    }

    function test_paysEachEpisodeOnlyOnce() public onlyForked {
        _createBounty();
        uint256 id = _submitAndValidate(keccak256("m1"));

        vm.startPrank(buyer);
        escrow.acceptEpisode(BOUNTY, id);
        vm.expectRevert(BountyEscrow.EpisodeAlreadyPaid.selector);
        escrow.acceptEpisode(BOUNTY, id);
        vm.stopPrank();
    }

    function test_refusesAnEpisodeSubmittedToAnotherBounty() public onlyForked {
        _createBounty();
        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, keccak256("other"), keccak256("m1"), "s3://ep");
        vm.prank(validator);
        episodes.recordValidation(id, 9000, EpisodeRegistry.TrustLevel.Heuristic);

        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.WrongBounty.selector);
        escrow.acceptEpisode(BOUNTY, id);
    }

    function test_onlyBuyerAccepts() public onlyForked {
        _createBounty();
        uint256 id = _submitAndValidate(keccak256("m1"));

        vm.prank(contributor);
        vm.expectRevert(BountyEscrow.NotBuyer.selector);
        escrow.acceptEpisode(BOUNTY, id);
    }

    function test_cannotExceedTheEpisodeQuota() public onlyForked {
        vm.prank(buyer);
        escrow.createBounty(
            BOUNTY, PER_EPISODE + POOL, PER_EPISODE, 1, POOL, 0, 0, uint64(block.timestamp + 30 days)
        );

        uint256 first = _submitAndValidate(keccak256("m1"));
        uint256 second = _submitAndValidate(keccak256("m2"));

        vm.startPrank(buyer);
        escrow.acceptEpisode(BOUNTY, first);
        vm.expectRevert(BountyEscrow.QuotaReached.selector);
        escrow.acceptEpisode(BOUNTY, second);
        vm.stopPrank();
    }

    function test_refundsOnlyWhatWasNeverOwed() public onlyForked {
        _createBounty();
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 contributorBefore = usdc.balanceOf(contributor);

        uint256 id = _submitAndValidate(keccak256("m1"));
        vm.prank(buyer);
        escrow.acceptEpisode(BOUNTY, id);

        vm.warp(block.timestamp + 31 days);
        vm.prank(buyer);
        escrow.refundExpired(BOUNTY);

        // The accepted episode's payment is the contributor's and is not
        // refundable; everything else comes back.
        assertEq(usdc.balanceOf(buyer), buyerBefore + BUDGET - PER_EPISODE);
        assertEq(escrow.balanceOf(contributor), PER_EPISODE);

        vm.prank(contributor);
        escrow.withdraw();
        assertEq(usdc.balanceOf(contributor) - contributorBefore, PER_EPISODE);
    }

    function test_cannotRefundBeforeTheDeadline() public onlyForked {
        _createBounty();
        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.DeadlineNotPassed.selector);
        escrow.refundExpired(BOUNTY);
    }

    function test_cannotRefundTwice() public onlyForked {
        _createBounty();
        vm.warp(block.timestamp + 31 days);

        vm.startPrank(buyer);
        escrow.refundExpired(BOUNTY);
        vm.expectRevert(BountyEscrow.BountyClosed.selector);
        escrow.refundExpired(BOUNTY);
        vm.stopPrank();
    }

    function test_cannotAcceptAfterTheDeadline() public onlyForked {
        _createBounty();
        uint256 id = _submitAndValidate(keccak256("m1"));

        vm.warp(block.timestamp + 31 days);
        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.DeadlinePassed.selector);
        escrow.acceptEpisode(BOUNTY, id);
    }

    function test_withdrawWithNothingCreditedReverts() public onlyForked {
        vm.prank(contributor);
        vm.expectRevert(BountyEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    function test_realUSDCRevertsRatherThanReturningFalse() public onlyForked {
        // Worth pinning: Circle's token reverts on insufficient allowance, so
        // the escrow's `if (!transferFrom(...))` guard is a backstop for other
        // tokens rather than the path USDC actually takes. A mock returning
        // false would have implied the opposite.
        address broke = address(0xBADBAD);
        vm.prank(broke);
        (bool ok,) = USDC.call(abi.encodeWithSignature("approve(address,uint256)", address(escrow), type(uint256).max));
        require(ok, "approve failed");

        vm.prank(broke);
        vm.expectRevert();
        escrow.createBounty(
            BOUNTY, BUDGET, PER_EPISODE, MAX_EPISODES, POOL, VALIDATOR_FEE, TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function test_escrowNeverOwesMoreThanItHolds() public onlyForked {
        _createBounty();

        uint96 owed;
        for (uint256 i = 0; i < 10; i++) {
            uint256 id = _submitAndValidate(keccak256(abi.encode("m", i)));
            vm.prank(buyer);
            escrow.acceptEpisode(BOUNTY, id);
            owed += PER_EPISODE;
        }

        assertLe(owed, usdc.balanceOf(address(escrow)));
        assertEq(escrow.getBounty(BOUNTY).spent, owed);
    }
}
