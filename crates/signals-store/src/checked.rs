#[macro_export]
macro_rules! checked_query {
    ($sql:literal $(,$arg:expr)* $(,)?) => {{
        if false { let _ = sqlx::query!($sql $(,$arg)*); }
        sqlx::query($sql)$(.bind($arg))*
    }};
}
#[macro_export]
macro_rules! checked_query_as {
    ($sql:literal $(,$arg:expr)* $(,)?) => {{
        if false { let _ = sqlx::query!($sql $(,$arg)*); }
        sqlx::query_as($sql)$(.bind($arg))*
    }};
}
#[macro_export]
macro_rules! checked_query_scalar {
    (<$db:ty,$out:ty> $sql:literal $(,$arg:expr)* $(,)?) => {{
        if false { let _ = sqlx::query!($sql $(,$arg)*); }
        sqlx::query_scalar::<$db,$out>($sql)$(.bind($arg))*
    }};
    ($sql:literal $(,$arg:expr)* $(,)?) => {{
        if false { let _ = sqlx::query!($sql $(,$arg)*); }
        sqlx::query_scalar($sql)$(.bind($arg))*
    }};
}
