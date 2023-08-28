import fs from "node:fs/promises";
import path from "node:path";
import minimist from "minimist";

import decodeAudio from 'audio-decode';
import { encode, decode, QPA_CONFIGS } from "./qpa.js";
import encodeWAV from "audiobuffer-to-wav";
import waveResampler from 'wave-resampler';

const QPA_SR = 5512;
const WAV_SR = 22050;

const argv = minimist(process.argv.slice(2));

if (argv._.length != 2)
  throw new Error(
    "usage:\n  node qpa_cli.js [-q <quality>] input.{qpa,wav,mp3,...} output.{qpa,wav}"
  );

const input = argv._[0];
const output = argv._[1];
const quality = argv.q ?? 2;
run(input, output);

function arrayToMonoAudioBuffer(array, sampleRate) {
  return {
    _channelData: [array],
    numberOfChannels: 1,
    sampleRate,
    getChannelData: function(channel) { return this._channelData[channel] },
  };
}

async function run(input, output) {
  const inFormat = path.extname(input).toLowerCase();
  const outFormat = path.extname(output).toLowerCase();

  const outFormats = [".qpa", ".wav"];

  if (!outFormats.includes(outFormat)) {
    throw new Error("output format must be .wav or .qpa");
  }

  const inFile = await fs.readFile(input);
  let inAudioBuffer, outFile;

  if (inFormat == '.qpa') {
    const samples = decode(inFile);
    const audio = arrayToMonoAudioBuffer(new Float32Array(samples.length).fill(0), QPA_SR);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] - 128;
      audio._channelData[0][i] = sample < 0 ? sample / 128 : sample / 127;
      //audio.channelData[0][i] = (samples[i] - 128) / 127;
    }
    inAudioBuffer = audio;
  } else {
    inAudioBuffer = await decodeAudio(inFile);
  }

  let inSamples = new Array(inAudioBuffer.getChannelData(0).length).fill(0);
  for (let i = 0; i < inAudioBuffer.numberOfChannels; i++) {
    const channelData = inAudioBuffer.getChannelData(i);
    for (let j = 0; j < inSamples.length; j++) {
      inSamples[j] += channelData[j];
    }
  }
  const norm = 1.0 / inAudioBuffer.numberOfChannels;
  for (let i = 0; i < inSamples.length; i++) {
    inSamples[i] *= norm;
  }


  if (outFormat == '.qpa') {
    if (inAudioBuffer.sampleRate !== QPA_SR) {
      inSamples = waveResampler.resample(inSamples, inAudioBuffer.sampleRate, QPA_SR, { method: "sinc" });
    }
    outFile = encode(inSamples, QPA_CONFIGS['qpa'+quality]);
  } else {
    if (inAudioBuffer.sampleRate !== WAV_SR) {
      // Use point resampling for closest possible approximation to PICO-8 behavior
      inSamples = waveResampler.resample(inSamples, inAudioBuffer.sampleRate, WAV_SR, { method: "point" });
    }
    outFile = new Uint8Array(encodeWAV(arrayToMonoAudioBuffer(inSamples, WAV_SR)));
  }
  if (outFile) {
    console.log("Writing:", output);
    await fs.writeFile(output, outFile);
  }
}
