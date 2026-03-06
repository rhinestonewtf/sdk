use alloy_primitives::{keccak256, Address, Bytes, FixedBytes, U256};

/// Splits a packed Compact token ID (32 bytes) into a lock tag (12 bytes) and token address (20 bytes).
///
/// In The Compact protocol, token IDs encode two pieces of information in a single `uint256`:
/// - Bytes 0..12: the lock tag (identifies the specific lock in the Compact contract)
/// - Bytes 12..32: the ERC-20 token address (20 bytes, same as a standard Ethereum address)
///
/// This is a big-endian encoding, so the lock tag occupies the high-order bytes.
///
/// # Example
///
/// For a token ID where the lock tag is all zeros and the token is USDC on Base:
/// ```text
/// 0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913
///   |---- lock tag ----||----- token address (20 bytes) -----|
/// ```
pub fn split_token_id(id: &U256) -> (FixedBytes<12>, Address) {
    // Convert the U256 to a 32-byte big-endian array.
    let bytes = id.to_be_bytes::<32>();
    // First 12 bytes are the lock tag.
    let lock_tag = FixedBytes::<12>::from_slice(&bytes[..12]);
    // Last 20 bytes are the token address.
    let token = Address::from_slice(&bytes[12..32]);
    (lock_tag, token)
}

/// Extracts the token address from the last 20 bytes of a packed token ID.
///
/// Same as `split_token_id` but discards the lock tag. Used when only the address is needed
/// (e.g. for `tokenOut` in Compact mandates).
pub fn extract_token_address(id: &U256) -> Address {
    let bytes = id.to_be_bytes::<32>();
    Address::from_slice(&bytes[12..32])
}

/// Extracts the token address using a 160-bit bitmask (Permit2-style).
///
/// Permit2 encodes token addresses differently from Compact. Instead of byte slicing,
/// it uses a bitmask to extract the lower 160 bits of the token ID. The upper 96 bits
/// may contain metadata that gets masked out.
///
/// The bitmask is: `(1 << 160) - 1` = `0x00000000000000000000000fffffffff...fff`
///
/// In practice this gives the same result as `extract_token_address` when the upper bytes
/// are zero, but the bitmask approach is consistent with how Permit2's Solidity code works.
pub fn to_token(id: &U256) -> Address {
    // Build a 160-bit mask: (1 << 160) - 1 = 0x0000...FFFFF (20 bytes of 0xFF).
    let mask = U256::from(1u64)
        .checked_shl(160)
        .unwrap_or(U256::ZERO)
        - U256::from(1u64);
    // Apply the mask to zero out the upper 96 bits.
    let token = *id & mask;
    // Convert to bytes and take the last 20 bytes as the address.
    let bytes = token.to_be_bytes::<32>();
    Address::from_slice(&bytes[12..32])
}

/// Computes keccak256 of raw bytes and returns the 32-byte hash.
///
/// Used to hash `qualifier.encodedVal` into the commitment hash `q` that appears
/// in all three settlement types' mandate structs.
pub fn keccak256_bytes(data: &Bytes) -> FixedBytes<32> {
    keccak256(data.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- split_token_id ----

    #[test]
    fn test_split_token_id_zero_lock_tag() {
        // Token ID with zero lock tag and a known token address (USDC on Base).
        let id = U256::from_str_radix(
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            16,
        )
        .unwrap();
        let (lock_tag, token) = split_token_id(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(lock_tag.as_slice())),
            "0x000000000000000000000000"
        );
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
    }

    #[test]
    fn test_split_token_id_nonzero_lock_tag() {
        // Token ID with a non-zero lock tag (first 12 bytes = 0xaabbcc...).
        let id = U256::from_str_radix(
            "aabbccddee112233445566770000000000000000000000000000000000000001",
            16,
        )
        .unwrap();
        let (lock_tag, token) = split_token_id(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(lock_tag.as_slice())),
            "0xaabbccddee11223344556677"
        );
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0x0000000000000000000000000000000000000001"
        );
    }

    #[test]
    fn test_split_token_id_all_zeros() {
        let id = U256::ZERO;
        let (lock_tag, token) = split_token_id(&id);
        assert_eq!(lock_tag, FixedBytes::<12>::ZERO);
        assert_eq!(token, Address::ZERO);
    }

    #[test]
    fn test_split_token_id_max_value() {
        let id = U256::MAX;
        let (lock_tag, token) = split_token_id(&id);
        // All bytes should be 0xFF.
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(lock_tag.as_slice())),
            "0xffffffffffffffffffffffff"
        );
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
    }

    // ---- extract_token_address ----

    #[test]
    fn test_extract_token_address_basic() {
        let id = U256::from_str_radix(
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            16,
        )
        .unwrap();
        let token = extract_token_address(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
    }

    #[test]
    fn test_extract_token_address_ignores_lock_tag() {
        // Even with a non-zero lock tag, extract_token_address returns just the address.
        let id = U256::from_str_radix(
            "ffffffffffffffffffffffff833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            16,
        )
        .unwrap();
        let token = extract_token_address(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
    }

    #[test]
    fn test_extract_token_address_zero() {
        let token = extract_token_address(&U256::ZERO);
        assert_eq!(token, Address::ZERO);
    }

    // ---- to_token (Permit2-style bitmask) ----

    #[test]
    fn test_to_token_basic() {
        let id = U256::from_str_radix(
            "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            16,
        )
        .unwrap();
        let token = to_token(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
    }

    #[test]
    fn test_to_token_masks_upper_bits() {
        // Upper 96 bits set to 0xFF — the bitmask should zero them out.
        let id = U256::from_str_radix(
            "ffffffffffffffffffffffff833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            16,
        )
        .unwrap();
        let token = to_token(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
    }

    #[test]
    fn test_to_token_zero() {
        let token = to_token(&U256::ZERO);
        assert_eq!(token, Address::ZERO);
    }

    #[test]
    fn test_to_token_max_address() {
        // All 160 lower bits set = address 0xFFFF...FFFF.
        let id = U256::from_str_radix(
            "000000000000000000000000ffffffffffffffffffffffffffffffffffffffff",
            16,
        )
        .unwrap();
        let token = to_token(&id);
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(token.as_slice())),
            "0xffffffffffffffffffffffffffffffffffffffff"
        );
    }

    // ---- to_token vs extract_token_address equivalence ----

    #[test]
    fn test_to_token_and_extract_agree_when_upper_bits_zero() {
        // When upper 96 bits are zero, both functions should return the same result.
        let id = U256::from_str_radix(
            "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            16,
        )
        .unwrap();
        assert_eq!(to_token(&id), extract_token_address(&id));
    }

    #[test]
    fn test_to_token_and_extract_agree_with_upper_bits() {
        // When upper 96 bits are non-zero, both functions should still return the same address.
        // extract_token_address uses byte slicing, to_token uses bitmask — same result.
        let id = U256::from_str_radix(
            "deadbeef00000000000000001234567890abcdef1234567890abcdef12345678",
            16,
        )
        .unwrap();
        assert_eq!(to_token(&id), extract_token_address(&id));
    }

    // ---- keccak256_bytes ----

    #[test]
    fn test_keccak256_bytes_empty() {
        // keccak256 of empty input is a well-known constant.
        let hash = keccak256_bytes(&Bytes::new());
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(hash.as_slice())),
            "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn test_keccak256_bytes_hello_world() {
        // keccak256("hello world") — verifiable reference hash.
        let hash = keccak256_bytes(&Bytes::from_static(b"hello world"));
        assert_eq!(
            format!("0x{}", alloy_primitives::hex::encode(hash.as_slice())),
            "0x47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad"
        );
    }

    #[test]
    fn test_keccak256_bytes_deterministic() {
        // Same input should always produce the same hash.
        let data = Bytes::from_static(b"test data");
        let hash1 = keccak256_bytes(&data);
        let hash2 = keccak256_bytes(&data);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_keccak256_bytes_different_inputs_different_hashes() {
        let hash1 = keccak256_bytes(&Bytes::from_static(b"input a"));
        let hash2 = keccak256_bytes(&Bytes::from_static(b"input b"));
        assert_ne!(hash1, hash2);
    }
}
