// Field IDs matching BaseDataTypes.sol
export const FIELD_ARBITER = 0
export const FIELD_EXPIRY = 1
export const FIELD_TOKEN_IN = 2
export const FIELD_RECIPIENT = 3
export const FIELD_FILL_EXPIRY = 4
export const FIELD_TOKEN_OUT = 5
export const FIELD_ORIGIN_OPS = 6
export const FIELD_DEST_OPS = 7
// Field 8 is reserved in BaseDataTypes.sol
export const FIELD_RECIPIENT_IS_SPONSOR = 9

// Mode values
export const MODE_CHECK_STORAGE = 1

// Sentinel: allows any recipient address
export const ANY_ADDRESS = '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF' as const
