// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Counter {
    uint256 public count;

    function increment() external {
        count += 1;
    }

    function doesNotExist() external pure {
        // never called directly — used to trigger a real ABI mismatch
        // failure mode when the spike script calls a selector this
        // contract doesn't implement.
        revert("unreachable");
    }
}
