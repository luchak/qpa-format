# QPA: Simple Lossy Compressed Audio for PICO-8

Questionable PICO-8 Audio (QPA) is an adaptation of the [Quite OK Audio Format (QOA)](https://qoaformat.org/) for the
[PICO-8](https://www.lexaloffle.com/pico-8.php) platform. Its benefits include:

- Tiny decoder. A fully-featured decoder with quality-level detection is just 2XX tokens. A minimal decoder is just 1XX tokens.
- Reasonable quality at very low data rates. QPA encodes mostly-intelligible speech at just 1.14 bits/sample (788 bytes/second) - or completely-intelligible speech, as well as usable instrument samples, at twice that rate.
- Faster-than-realtime decoding speed. Precise speed depends on the decoder implementation, but around 4x realtime is a reasonable expectation for a token-optimized (not CPU-optimized) decoder.

## ⚠️ Warning

As always with audio code, be careful when experimenting. Bugs or bad data can produce loud sounds that can damage your
ears.

I will attempt to avoid breaking changes to this format going forward, but I cannot promise anything on that front.

## Encoder Usage

You can encode audio files like so:

```
node src/cli.js -q 3 input.wav output.qpa
```

Or, if you run `npm i -g .` to install globally:

```
qpa-format -q 3 input.wav output.qpa
```

The command above will encode `input.wav` to `output.qpa` at quality level 3. QPA's quality levels are:

1. 1.1 bits per sample, or 7:1 compression. Can store noisy but usually-intelligible speech, and can work very well for
   some categories of instruments and sound effects.
2. 2.3 bits per sample, or 3.5:1 compression. Stores reasonable-quality speech, and usable instrument samples. Can
   still be moderately noisy.
3. 3.2 bits per sample, or 2.5:1 compression. Good quality, usually still has some artifacts, but often better than 4
   bit ADPCM.
4. 3.6 bits per sample, or 2.25:1 compression. Minimal artifacts, sometimes perceptually transparent (or as much as
   anything can be at 8 bits / 5.5 kHz). Usually better than 4 bit ADPCM.
5. 4.6 bits per sample, or 1.75:1 compression. Usually perceptually transparent, at least to my ear.

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
4. Copy the `qpa_decode_string()` function from this repo into your cart. Use it to decode your audio. You will need to
   handle PCM audio output on your own, but the demo cart contains a simple example.
