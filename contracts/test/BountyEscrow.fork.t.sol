// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {BountyEscrow, IERC20} from "../src/BountyEscrow.sol";
import {EntityRegistry} from "../src/EntityRegistry.sol";
import {EpisodeRegistry} from "../src/EpisodeRegistry.sol";

/**
 * Escrow tests against the real USDC on Ethereum Sepolia.
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
    /// @dev Circle's official USDC on Ethereum Sepolia.
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    uint256 internal constant SEPOLIA = 11155111;

    IERC20 internal usdc = IERC20(USDC);
    EntityRegistry internal entities;
    AssetRegistry internal assets;
    EpisodeRegistry internal episodes;
    BountyEscrow internal escrow;

    address internal buyer = address(0xB0B);
    address internal contributor = address(0xC0FFEE);
    address internal validator = address(0xDA7A);
    address internal contributorTwo = address(0xBEEF);
    address internal treasury = address(0x7EA5);

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
        try vm.envString("SEPOLIA_RPC_URL") returns (string memory url) {
            vm.createSelectFork(url);
            forked = block.chainid == SEPOLIA;
        } catch {
            forked = false;
        }
        if (!forked) return;

        entities = new EntityRegistry();
        assets = new AssetRegistry(entities);
        episodes = new EpisodeRegistry(assets);
        escrow = new BountyEscrow(usdc, episodes);
        episodes.setValidator(validator, true);
        escrow.setTreasury(treasury);

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
            BOUNTY,
            BUDGET,
            PER_EPISODE,
            MAX_EPISODES,
            POOL,
            VALIDATOR_FEE,
            TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function _submitAndValidate(bytes32 manifest) internal returns (uint256 id) {
        vm.prank(contributor);
        id = episodes.submitEpisode(assetId, BOUNTY, manifest, "s3://ep");
        vm.prank(validator);
        episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);
    }

    function test_forkIsEthereumSepoliaWithRealUSDC() public onlyForked {
        assertEq(block.chainid, SEPOLIA);
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
            BOUNTY,
            BUDGET,
            PER_EPISODE,
            MAX_EPISODES,
            40_000_000,
            VALIDATOR_FEE,
            TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function test_rejectsBountyThatUnderspendsItsBudget() public onlyForked {
        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.BudgetMismatch.selector);
        escrow.createBounty(
            BOUNTY,
            BUDGET,
            PER_EPISODE,
            MAX_EPISODES,
            10_000_000,
            VALIDATOR_FEE,
            TREASURY_FEE,
            uint64(block.timestamp + 30 days)
        );
    }

    function test_contributorIsPaidInRealUSDC() public onlyForked {
        _createBounty();
        uint256 id = _submitAndValidate(keccak256("m1"));

        // Balances are measured as deltas. On a real chain an address has
        // history: 0xC0FFEE already holds USDC on Ethereum Sepolia, and asserting
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
        escrow.createBounty(BOUNTY, PER_EPISODE + POOL, PER_EPISODE, 1, POOL, 0, 0, uint64(block.timestamp + 30 days));

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
        // refundable, and neither are the validator and treasury shares that
        // accrued alongside it. Everything else comes back.
        uint96 spentOnOne = PER_EPISODE + VALIDATOR_FEE / MAX_EPISODES + TREASURY_FEE / MAX_EPISODES;
        assertEq(usdc.balanceOf(buyer), buyerBefore + BUDGET - spentOnOne);
        assertEq(escrow.balanceOf(contributor), PER_EPISODE);
        assertEq(escrow.balanceOf(validator), VALIDATOR_FEE / MAX_EPISODES);
        assertEq(escrow.balanceOf(treasury), TREASURY_FEE / MAX_EPISODES);

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
            BOUNTY,
            BUDGET,
            PER_EPISODE,
            MAX_EPISODES,
            POOL,
            VALIDATOR_FEE,
            TREASURY_FEE,
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
            // Acceptance owes the contributor, the validator that checked it
            // and the treasury; the invariant is over all three.
            owed += PER_EPISODE + VALIDATOR_FEE / MAX_EPISODES + TREASURY_FEE / MAX_EPISODES;
        }

        assertLe(owed, usdc.balanceOf(address(escrow)));
        assertEq(escrow.getBounty(BOUNTY).spent, owed);
    }

    // ---------------------------------------------------------------------
    // Settlement — product-spec §8.3 and §13.
    //
    // An earlier version of this contract escrowed the utility pool, the
    // validator fee and the treasury fee and could pay out none of them. Forty
    // percent of every bounty could reach nobody but the buyer. These tests
    // exist so that cannot come back.
    // ---------------------------------------------------------------------

    /// @dev A bounty small enough to fill inside one test: 4 USDC, 4 episodes.
    bytes32 internal constant SMALL = keccak256("bounty_small");
    uint96 internal constant SMALL_BUDGET = 4_000_000;
    uint96 internal constant SMALL_PER_EPISODE = 600_000;
    uint32 internal constant SMALL_MAX = 4;
    uint96 internal constant SMALL_POOL = 1_000_000;
    uint96 internal constant SMALL_VALIDATOR = 400_000;
    uint96 internal constant SMALL_TREASURY = 200_000;

    function _createSmallBounty() internal {
        vm.prank(buyer);
        escrow.createBounty(
            SMALL,
            SMALL_BUDGET,
            SMALL_PER_EPISODE,
            SMALL_MAX,
            SMALL_POOL,
            SMALL_VALIDATOR,
            SMALL_TREASURY,
            uint64(block.timestamp + 30 days)
        );
    }

    function _fillSmallBounty() internal {
        for (uint256 i = 0; i < SMALL_MAX; i++) {
            vm.prank(contributor);
            uint256 id = episodes.submitEpisode(assetId, SMALL, keccak256(abi.encode("m", i)), "s3://ep");
            vm.prank(validator);
            episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);
            vm.prank(buyer);
            escrow.acceptEpisode(SMALL, id);
        }
    }

    function test_creditsTheValidatorAndTreasuryOnAcceptance() public onlyForked {
        _createSmallBounty();

        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, SMALL, keccak256("one"), "s3://ep");
        vm.prank(validator);
        episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);
        vm.prank(buyer);
        escrow.acceptEpisode(SMALL, id);

        // Each fee accrues its per-episode fraction, to the validator that
        // actually recorded this episode's result.
        assertEq(escrow.balanceOf(contributor), SMALL_PER_EPISODE);
        assertEq(escrow.balanceOf(validator), SMALL_VALIDATOR / SMALL_MAX);
        assertEq(escrow.balanceOf(treasury), SMALL_TREASURY / SMALL_MAX);
    }

    /**
     * @dev attestcoin.md's A2: a dedicated, unambiguous event an off-chain
     * worker can decode without guessing at a generic event's meaning —
     * `EpisodeAccepted` already exists for the marketplace's own use, but
     * nothing before this named itself for attestation or carried the
     * validator's score. Both are needed on the Creditcoin side: the
     * attestor proves this exact Sepolia tx happened, and the ASC's business
     * logic reads `score` to decide what "accepted" was worth.
     */
    function test_emitsAttestationEventOnAcceptance() public onlyForked {
        _createSmallBounty();

        vm.prank(contributor);
        uint256 id = episodes.submitEpisode(assetId, SMALL, keccak256("one"), "s3://ep");
        vm.prank(validator);
        episodes.recordValidation(id, 8310, EpisodeRegistry.TrustLevel.Heuristic);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit BountyEscrow.EpisodeAcceptedForAttestation(id, contributor, 8310, SMALL);

        vm.prank(buyer);
        escrow.acceptEpisode(SMALL, id);
    }

    function test_settlesTheUtilityPoolByMeasuredShare() public onlyForked {
        _createSmallBounty();

        address[] memory who = new address[](2);
        who[0] = contributor;
        who[1] = contributorTwo;
        uint32[] memory shares = new uint32[](2);
        shares[0] = 7_500;
        shares[1] = 2_500;

        uint256 before = escrow.balanceOf(contributor);
        escrow.settleUtility(SMALL, who, shares);

        assertEq(escrow.balanceOf(contributor) - before, (uint256(SMALL_POOL) * 7_500) / 10_000);
        assertEq(escrow.balanceOf(contributorTwo), (uint256(SMALL_POOL) * 2_500) / 10_000);
    }

    function test_utilityPoolSettlesOnlyOnce() public onlyForked {
        _createSmallBounty();

        address[] memory who = new address[](1);
        who[0] = contributor;
        uint32[] memory shares = new uint32[](1);
        shares[0] = 10_000;

        escrow.settleUtility(SMALL, who, shares);
        vm.expectRevert(BountyEscrow.UtilityAlreadySettled.selector);
        escrow.settleUtility(SMALL, who, shares);
    }

    function test_onlyTheOracleCanSettleUtility() public onlyForked {
        _createSmallBounty();

        address[] memory who = new address[](1);
        who[0] = contributor;
        uint32[] memory shares = new uint32[](1);
        shares[0] = 10_000;

        // Explicitly including the buyer: a buyer who could choose which
        // contributors were "useful" would be grading the work they pay for.
        vm.prank(buyer);
        vm.expectRevert(BountyEscrow.NotOracle.selector);
        escrow.settleUtility(SMALL, who, shares);
    }

    function test_rejectsSharesThatDoNotTotalTenThousand() public onlyForked {
        _createSmallBounty();

        address[] memory who = new address[](2);
        who[0] = contributor;
        who[1] = contributorTwo;
        uint32[] memory shares = new uint32[](2);
        shares[0] = 6_000;
        shares[1] = 3_000; // 9000 — would silently strand a tenth of the pool.

        vm.expectRevert(BountyEscrow.SharesMustTotalBps.selector);
        escrow.settleUtility(SMALL, who, shares);
    }

    function test_rejectsMismatchedRecipientsAndShares() public onlyForked {
        _createSmallBounty();

        address[] memory who = new address[](2);
        who[0] = contributor;
        who[1] = contributorTwo;
        uint32[] memory shares = new uint32[](1);
        shares[0] = 10_000;

        vm.expectRevert(BountyEscrow.LengthMismatch.selector);
        escrow.settleUtility(SMALL, who, shares);
    }

    /**
     * The regression test this whole change exists for.
     *
     * Fill the bounty, settle the pool, and have everyone withdraw. Every cent
     * the buyer escrowed must end up with somebody — not stuck in the contract
     * with only the buyer's refund path out.
     */
    function test_everyEscrowedCentCanReachSomebody() public onlyForked {
        _createSmallBounty();
        assertEq(usdc.balanceOf(address(escrow)), SMALL_BUDGET);

        _fillSmallBounty();

        address[] memory who = new address[](2);
        who[0] = contributor;
        who[1] = contributorTwo;
        uint32[] memory shares = new uint32[](2);
        shares[0] = 5_000;
        shares[1] = 5_000;
        escrow.settleUtility(SMALL, who, shares);

        // Deltas, not balances: these are real addresses on a real chain and
        // 0xC0FFEE already holds USDC of its own.
        uint256[4] memory before = [
            usdc.balanceOf(contributor),
            usdc.balanceOf(contributorTwo),
            usdc.balanceOf(validator),
            usdc.balanceOf(treasury)
        ];

        vm.prank(contributor);
        escrow.withdraw();
        vm.prank(contributorTwo);
        escrow.withdraw();
        vm.prank(validator);
        escrow.withdraw();
        vm.prank(treasury);
        escrow.withdraw();

        uint256 paidOut = (usdc.balanceOf(contributor) - before[0]) + (usdc.balanceOf(contributorTwo) - before[1])
            + (usdc.balanceOf(validator) - before[2]) + (usdc.balanceOf(treasury) - before[3]);

        // Only integer-division dust may remain, and it refunds to the buyer.
        uint256 stranded = usdc.balanceOf(address(escrow));
        assertEq(paidOut + stranded, SMALL_BUDGET);
        assertLt(stranded, 100, "more than dust could not be paid out");
    }

    function test_undistributedDustRefundsToTheBuyer() public onlyForked {
        _createSmallBounty();
        _fillSmallBounty();

        address[] memory who = new address[](2);
        who[0] = contributor;
        who[1] = contributorTwo;
        uint32[] memory shares = new uint32[](2);
        shares[0] = 5_000;
        shares[1] = 5_000;
        escrow.settleUtility(SMALL, who, shares);

        uint256 stranded = escrow.unspent(SMALL);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.warp(block.timestamp + 31 days);
        vm.prank(buyer);
        escrow.refundExpired(SMALL);

        assertEq(usdc.balanceOf(buyer) - buyerBefore, stranded);
    }

    function test_utilityCannotBeSettledAfterRefund() public onlyForked {
        _createSmallBounty();

        vm.warp(block.timestamp + 31 days);
        vm.prank(buyer);
        escrow.refundExpired(SMALL);

        address[] memory who = new address[](1);
        who[0] = contributor;
        uint32[] memory shares = new uint32[](1);
        shares[0] = 10_000;

        // The money is already back with the buyer; crediting it again would
        // promise USDC the contract no longer holds.
        vm.expectRevert(BountyEscrow.BountyClosed.selector);
        escrow.settleUtility(SMALL, who, shares);
    }
}
