// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Relayable
 * @notice EIP-712 signature verification for contributor-signed, relayer-paid calls.
 *
 * The whole contributor path depends on this. Someone with a phone strapped to
 * their head has a key, not a funded account — so every action they take is
 * signed on the device and submitted by a relayer, with the action attributed
 * to the RECOVERED SIGNER rather than to whoever paid the gas.
 *
 * That deletes the paymaster problem from the onboarding path entirely: no
 * sponsored transactions, no account abstraction, no gas prompt. The relayer is
 * untrusted — it can refuse to submit, but it cannot alter what was signed or
 * claim the result for itself.
 */
abstract contract Relayable {
    /// @notice Per-signer replay protection.
    mapping(address => uint256) public nonces;

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev Upper bound of the lower half of the secp256k1 curve order.
    uint256 private constant _HALF_CURVE_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    error InvalidSignature();

    /// @dev Each contract names its own domain so a signature cannot cross between them.
    function _domainName() internal pure virtual returns (string memory);

    /**
     * @notice EIP-712 domain separator.
     * @dev Computed per call rather than cached at construction: a cached value
     *      would stay valid after a chain fork, letting signatures be replayed
     *      on the forked chain.
     */
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(_domainName())),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /**
     * @dev Verify a signature against an expected signer and consume their nonce.
     *      The nonce is consumed before any effect, so a signature cannot be
     *      replayed even if the caller reverts afterwards.
     */
    function _consumeSignature(address signer, bytes32 structHash, bytes calldata signature) internal {
        if (_recover(_digest(structHash), signature) != signer) revert InvalidSignature();
        nonces[signer] += 1;
    }

    /**
     * @dev Recovers a 65-byte signature.
     *
     * Rejects the malleable upper half of the curve order: for every valid
     * signature there is a second one with the same signer, and accepting both
     * would let a single approval be used twice under different digests.
     * Also rejects the zero address that ecrecover returns on failure.
     */
    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > _HALF_CURVE_ORDER) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }
}
