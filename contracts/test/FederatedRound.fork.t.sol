// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FederatedRound, IERC20Minimal} from "../src/FederatedRound.sol";

/**
 * §9's coordination pattern, tested for the property it actually claims:
 * participation is recorded and paid, and the data never appears anywhere.
 */
contract FederatedRoundForkTest is Test {
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    uint256 internal constant SEPOLIA = 11155111;

    FederatedRound internal rounds;

    address internal coordinator = address(0xC007);
    address internal orgA = address(0xA1);
    address internal orgB = address(0xB2);
    address internal outsider = address(0x0117);

    bytes32 internal constant MODEL = keccak256("worldmod_dynamics_v1");
    uint96 internal constant PAYOUT = 5_000_000; // 5 USDC each

    bool internal forked;

    function setUp() public {
        try vm.envString("SEPOLIA_RPC_URL") returns (string memory url) {
            vm.createSelectFork(url);
            forked = block.chainid == SEPOLIA;
        } catch {
            forked = false;
        }
        if (!forked) return;

        rounds = new FederatedRound(IERC20Minimal(USDC));

        deal(USDC, coordinator, 1_000_000_000, true);
        vm.prank(coordinator);
        (bool ok,) = USDC.call(abi.encodeWithSignature("approve(address,uint256)", address(rounds), type(uint256).max));
        require(ok, "approve failed");
    }

    modifier onlyForked() {
        if (!forked) return;
        _;
    }

    function _open() internal returns (uint256 roundId) {
        address[] memory participants = new address[](2);
        participants[0] = orgA;
        participants[1] = orgB;

        vm.prank(coordinator);
        roundId = rounds.openRound(MODEL, participants, PAYOUT);
    }

    function test_opensARoundAndEscrowsEveryPayout() public onlyForked {
        uint256 roundId = _open();

        FederatedRound.Round memory round = rounds.getRound(roundId);
        assertEq(round.participantCount, 2);
        assertEq(uint8(round.status), uint8(FederatedRound.Status.Open));
        assertEq(_usdc(address(rounds)), uint256(PAYOUT) * 2);
    }

    function test_recordsEachParticipantsUpdateHash() public onlyForked {
        uint256 roundId = _open();

        vm.prank(orgA);
        rounds.submitUpdate(roundId, keccak256("delta_a"));
        vm.prank(orgB);
        rounds.submitUpdate(roundId, keccak256("delta_b"));

        // The whole verifiability claim: a participant who later describes a
        // different update is contradicted by their own hash.
        assertEq(rounds.updateOf(roundId, orgA), keccak256("delta_a"));
        assertEq(rounds.updateOf(roundId, orgB), keccak256("delta_b"));
        assertEq(rounds.getRound(roundId).submittedCount, 2);
    }

    function test_refusesAnUpdateFromSomeoneNotInTheRound() public onlyForked {
        uint256 roundId = _open();

        vm.prank(outsider);
        vm.expectRevert(FederatedRound.NotParticipant.selector);
        rounds.submitUpdate(roundId, keccak256("delta_x"));
    }

    function test_refusesToRewriteAnUpdate() public onlyForked {
        // A participant who could revise after seeing the global model could
        // claim to have submitted whatever turned out to help.
        uint256 roundId = _open();

        vm.startPrank(orgA);
        rounds.submitUpdate(roundId, keccak256("delta_a"));
        vm.expectRevert(FederatedRound.AlreadySubmitted.selector);
        rounds.submitUpdate(roundId, keccak256("delta_a_better"));
        vm.stopPrank();
    }

    function test_finalizesAndPaysEveryoneWhoSubmitted() public onlyForked {
        uint256 roundId = _open();

        vm.prank(orgA);
        rounds.submitUpdate(roundId, keccak256("delta_a"));
        vm.prank(orgB);
        rounds.submitUpdate(roundId, keccak256("delta_b"));

        vm.prank(coordinator);
        rounds.finalizeRound(roundId, keccak256("global_v2"), 6_800);

        FederatedRound.Round memory round = rounds.getRound(roundId);
        assertEq(uint8(round.status), uint8(FederatedRound.Status.Finalized));
        assertEq(round.globalHash, keccak256("global_v2"));
        assertEq(round.metricBps, 6_800);

        assertEq(rounds.balanceOf(orgA), PAYOUT);
        assertEq(rounds.balanceOf(orgB), PAYOUT);

        uint256 before = _usdc(orgA);
        vm.prank(orgA);
        rounds.withdraw();
        assertEq(_usdc(orgA) - before, PAYOUT);
    }

    function test_doesNotPayAParticipantWhoSatTheRoundOut() public onlyForked {
        uint256 roundId = _open();

        vm.prank(orgA);
        rounds.submitUpdate(roundId, keccak256("delta_a"));

        vm.prank(coordinator);
        rounds.finalizeRound(roundId, keccak256("global_v2"), 7_000);

        assertEq(rounds.balanceOf(orgA), PAYOUT);
        assertEq(rounds.balanceOf(orgB), 0);
        // The no-show's escrow goes back to whoever funded the round rather
        // than being stranded in the contract.
        assertEq(rounds.balanceOf(coordinator), PAYOUT);
    }

    function test_onlyTheCoordinatorFinalizes() public onlyForked {
        uint256 roundId = _open();

        vm.prank(orgA);
        vm.expectRevert(FederatedRound.NotCoordinator.selector);
        rounds.finalizeRound(roundId, keccak256("global_v2"), 7_000);
    }

    function test_refusesToFinalizeTwice() public onlyForked {
        uint256 roundId = _open();

        vm.startPrank(coordinator);
        rounds.finalizeRound(roundId, keccak256("global_v2"), 7_000);
        vm.expectRevert(FederatedRound.RoundAlreadyFinalized.selector);
        rounds.finalizeRound(roundId, keccak256("global_v3"), 6_000);
        vm.stopPrank();
    }

    function test_refusesAnUpdateAfterTheRoundClosed() public onlyForked {
        uint256 roundId = _open();

        vm.prank(coordinator);
        rounds.finalizeRound(roundId, keccak256("global_v2"), 7_000);

        vm.prank(orgA);
        vm.expectRevert(FederatedRound.RoundNotOpen.selector);
        rounds.submitUpdate(roundId, keccak256("late"));
    }

    function test_refusesADuplicateParticipant() public onlyForked {
        address[] memory participants = new address[](2);
        participants[0] = orgA;
        participants[1] = orgA; // Would be paid twice for one update.

        vm.prank(coordinator);
        vm.expectRevert(FederatedRound.DuplicateParticipant.selector);
        rounds.openRound(MODEL, participants, PAYOUT);
    }

    function test_everyEscrowedCentIsAccountedFor() public onlyForked {
        uint256 roundId = _open();

        vm.prank(orgA);
        rounds.submitUpdate(roundId, keccak256("delta_a"));

        vm.prank(coordinator);
        rounds.finalizeRound(roundId, keccak256("global_v2"), 7_000);

        uint256 credited = rounds.balanceOf(orgA) + rounds.balanceOf(orgB) + rounds.balanceOf(coordinator);
        assertEq(credited, uint256(PAYOUT) * 2);
    }

    function _usdc(address who) internal view returns (uint256) {
        (, bytes memory data) = USDC.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        return abi.decode(data, (uint256));
    }
}
