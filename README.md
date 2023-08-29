# QPA: Lossy Audio Compression for PICO-8

Questionable PICO-8 Audio (QPA) is an adaptation of the [Quite OK Audio Format (QOA)](https://qoaformat.org/) for the
[PICO-8](https://www.lexaloffle.com/pico-8.php) platform. Its benefits include:

- Tiny decoder. A fully-featured decoder with quality-level detection is just 228 tokens. A minimal decoder is just 175 tokens.
- Reasonable quality at very low data rates. QPA encodes mostly-intelligible speech at just 1.14 bits/sample (788 bytes/second) - or completely-intelligible speech, as well as usable instrument samples, at twice that rate.
- Faster-than-realtime decoding speed. Precise speed depends on the decoder implementation, but around 4x realtime is a reasonable expectation for a token-optimized (not CPU-optimized) decoder.

## ⚠️ Warning

As always with audio code, be careful when experimenting. Bugs or bad data can produce loud sounds that can damage your
ears.

I will attempt to avoid breaking changes to this format going forward, but I cannot promise anything on that front.

## Encoder Usage

You will need Node and NPM installed to use the decoder, and you'll need to run `npm i` to install dependencies. Then you
can encode audio files like so:

```
node src/cli.js -q 3 input.wav output.qpa
```

Or, if you run `npm i -g .` to install globally:

```
qpa-format -q 3 input.wav output.qpa
```

The command above will encode `input.wav` to `output.qpa` at quality level 3. QPA's quality levels are:

| level | ratio  | bits / sample | bytes / second | description                                                                                    |
| ----- | ------ | ------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| 1     | 7:1    | 1.1           | 788            | Noisy but mostly intelligible speech, can work well for some of instruments and sound effects. |
| 2     | 3.5:1  | 2.3           | 1585           | Reasonable-quality speech, usable instrument samples. Still moderately noisy.                  |
| 3     | 2.5:1  | 3.2           | 2205           | Good quality, usually has some artifacts, but often better than 4-bit ADPCM.                   |
| 4     | 2.25:1 | 3.6           | 2481           | Few to no audible artifacts. Usually better than 4-bit ADPCM.                                  |
| 5     | 1.75:1 | 4.6           | 3170           | No easily discernable artifacts (at least to my ear), very little noise.                       |

When encoding to QPA, the encoder will mix down multi-channel audio files to a single channel, and resample to 5512.5 Hz.

You can also use the tool to decode from QPA to WAV. When used this way, the quality setting is ignored, and audio is
upsampled to 22050 Hz using nearest-neighbor interpolation in order to approximate PICO-8's audio output.

## PICO-8 Decoder and Utility Cart

The `pico8/` directory contains a utility cart that provides:

- Low-token QPA loading and decoding functions. These include loading QPA data from dropped files, decoding QPA from
  PICO-8 memory, and decoding QPA from strings.
- Loading and previewing of QPA files to verify proper encoding.
- Conversion of QPA files to binary data strings you can paste into your carts.

## Using QPA in Your Project

The simplest way to do use QPA compression in your project is probably:

1. Use this CLI or (soon) @bikibird's [Defy](https://bikibird.github.io/defy) tool to convert your audio file to QPA.
   The decoding functions in this repo have a limit of ~32k samples, so try to stick to audio files of 6 seconds or
   less.
2. Load the utility cart at `pico8/qpa_util.p8`. Drop your encoded file on it and press X to verify proper playback.
3. Copy the string that the utility cart has already sent to the clipboard. Paste this string into your cart.
4. Copy the `qpa_decode_string()` function and the `qpa_cfg` table from the utility cart into your cart. Use it to
   decode your audio. You will need to handle PCM audio output on your own, but the demo cart contains a simple
   example.

## Credits

- @phoboslab: [The Quite OK Audio Format](https://qoaformat.org)
- @mattdesl: [qoa-format](https://github.com/mattdesl/qoa-format)
