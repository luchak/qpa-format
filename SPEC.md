# Questionable PICO-8 Audio (QPA) Spec

This document defines the QPA format. This format is a close derivative of the [Quite OK Audio (QOA) format](https://qoaformat.org), but specialized to PICO-8's constraints and the needs of PICO-8 cart authors.

## Structure

QPA supports encoding of unsigned 8-bit mono audio only.
A QPA file consists of the following elements in the following order:

1. A 4-byte identifier string. There are 5 possible strings, `qpa1` through `qpa5`. The numeral at the end indicates the quality level of the compression.
2. A 4-byte little-endian integer, representing the number of samples in the file. The high byte of this integer is reserved for future use and must be 0.
3. A sequence of 4-byte little-endian integers, which represent _slices_ of audio data.

### Slice Structure

Each slice consists of a _scale factor_ in the highest-order bits, followed by a sequence of _residuals_, running from high to low-order bits. The sizes of slices and residuals, as well as the number of residuals per slice, depends on the quality level.

| Quality Level | Identifier | Scale Bits | Residual Bits | Residuals / Slice |
| ------------- | ---------- | ---------- | ------------- | ----------------- |
| 1             | `qpa1`     | 4          | 1             | 28                |
| 2             | `qpa2`     | 4          | 2             | 14                |
| 3             | `qpa3`     | 2          | 3             | 10                |
| 4             | `qpa4`     | 5          | 3             | 9                 |
| 5             | `qpa5`     | 4          | 4             | 7                 |

All slices in the file, other than the last, encode exactly as many audio samples as the number of residuals they contain. The last slice in the file may have unused trailing residuals, as indicated by the file's sample count, but the slice must still be 4 bytes long.

## Decoding

(Note: code in this section is written in Lua, which uses 1-based table indexing, and references a few simple PICO-8 API functions.)

Decoding follows largely the same process as in QOA. However, unlike in QOA, all numbers are assumed to use PICO-8's native q16.16 format, and all arithmetic and bit operations should emulate PICO-8's behavior exactly. Because of this, tricky operations (like raising a number to a non-integer power) are avoided.

QPA is built around a sign-data LMS model that it uses to predict sample values. For each sample, QPA uses this model to generate a prediction, then uses a residual value from the file to correct that prediction and produce the final sample value. The decoder both outputs the sample and uses it to update the LMS model weights.

To perform these predictions, the decoder maintains two 4-element numeric arrays: `history` and `weight`. It also keeps track of the current slice, and the current residual within that slice.

### Dequantization Tables

During decoding, residual values are interpreted as 0-based offsets into a quality-level-specific _dequantization table_ of residual values.

| Quality Level | Dequantization Table                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1             | 0x0.20, -0x0.20                                                                                                                        |
| 2             | 0x0.10, -0x0.10, 0x0.40, -0x0.40                                                                                                       |
| 3             | 0x0.60, -0x0.60, 0x1.4b, -0x1.4b, 0x2.8f, -0x2.8f, 0x4.00, -0x4.00                                                                     |
| 4             | 0x0.02, -0x0.02, 0x0.08, -0x0.08, 0x0.0f, -0x0.0f, 0x0.18, -0x0.18                                                                     |
| 5             | 0x0.06, -0x0.06, 0x0.14, -0x0.14, 0x0.24, -0x0.24, 0x0.35, -0x0.35, 0x0.47, -0x0.47, 0x0.5a, -0x0.5a, 0x0.6d, -0x0.6d, 0x0.80, -0x0.80 |

### Decoding Setup

When a QPA file is loaded, the decoder checks the identifier string and loads appropriate quality level constants, including the dequantization table `dq_table`. It reads the sample count, interpreting it as as u32 (not q16.16). If the identifier string does not correspond to one of the 5 quality levels, if or the high byte of the sample count is not 0, then the file is invalid, and the decoder should report an error.

The decoder now initializes the `history` and `weight` arrays. `history` is initialized to all 0, `weight` is initialized to `[0, 0, -32, 64]` (in q16.16 format).

### Slice Interpretation

For each slice, the decoder first reads the scale factor, `sf`. Then, for each residual `r` in the slice, the decoder generates a prediction:

```lua
prediction = 0
for i=1,4 do
	prediction = prediction + history[i] * weight[i]
end
```

The decoder then dequantizes the residual value, corrects its prediction based on the dequantized residual and the scale factor, and clamps this value to the output range:

```lua
dequantized = dq_table[r + 1]
sample = prediction + sf * sf * dequantized
sample = mid(-128, sample, 127)
```

(Observe that unlike QOA, scale factors are simply squared instead of being read from another table.)

The decoder finally updates the weights and the history, applying several right shifts to maintain system stability. The same shift is applied for all quality levels, and shift amounts were determined empirically in order to maintain stability even for extreme inputs.

```lua
delta = dequantized >> 4
for i=1,4 do
	weights[i] = weights[i] + sgn(history[i]) * delta
end
for i=1,3 do
    history[i] = history[i+1]
end
history[3] = sample >> 8
```

Finally, the decoder shifts the output sample from s8 to u8. It may also choose to round the sample at this point. Note that the sample _must not_ be rounded before it is appended to the history.

```lua
add(out, flr(sample) + 128)
```

The decoder repeats this process - reading residuals until the end of each slice, then moving on to the next slice - until it has decoded the proper number of samples (at which point remaining residuals are ignored) or reached the end of the file, whichever comes first.
