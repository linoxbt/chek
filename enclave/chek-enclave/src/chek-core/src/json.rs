//! 64-bit IDs as decimal strings in JSON (JavaScript numbers can't hold them) and as plain u64
//! in BCS and other binary formats.

pub mod u64_string {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        if s.is_human_readable() {
            s.serialize_str(&v.to_string())
        } else {
            s.serialize_u64(*v)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        if d.is_human_readable() {
            String::deserialize(d)?.parse().map_err(D::Error::custom)
        } else {
            u64::deserialize(d)
        }
    }
}

pub mod u64_string_opt {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &Option<u64>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(v) if s.is_human_readable() => s.serialize_some(&v.to_string()),
            Some(v) => s.serialize_some(v),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
        if d.is_human_readable() {
            Option::<String>::deserialize(d)?
                .map(|s| s.parse().map_err(D::Error::custom))
                .transpose()
        } else {
            Option::<u64>::deserialize(d)
        }
    }
}
