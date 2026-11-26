use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};

/// Blake2b with a 32-byte digest, the hash Sui exposes as `sui::hash::blake2b256`.
pub fn blake2b256(data: &[u8]) -> [u8; 32] {
    let mut h = Blake2b::<U32>::new();
    h.update(data);
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    #[test]
    fn empty_string_known_answer() {
        assert_eq!(
            hex::encode(super::blake2b256(b"")),
            "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"
        );
    }
}
