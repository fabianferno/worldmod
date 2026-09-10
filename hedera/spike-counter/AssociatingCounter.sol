// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
}

address constant HTS_PRECOMPILE = address(0x167);

contract AssociatingCounter {
    uint256 public count;
    bool public associatedInConstructor;

    constructor(address usdc, bool associateNow) {
        if (associateNow) {
            (bool success, bytes memory result) = HTS_PRECOMPILE.call(
                abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), usdc)
            );
            int64 code = success && result.length >= 32 ? abi.decode(result, (int64)) : int64(-1);
            associatedInConstructor = success && code == 22; // SUCCESS = 22
        }
    }

    function increment() external {
        count += 1;
    }

    function associate(address token) external returns (int64 responseCode) {
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), token)
        );
        require(success, "precompile call failed");
        responseCode = abi.decode(result, (int64));
    }
}
