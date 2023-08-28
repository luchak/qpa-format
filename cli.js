import fs from 'node:fs/promises';
import path from 'node:path';

import AudioBuffer from 'audio-buffer';
import decodeAudio from 'audio-decode';
import encodeWAV from 'audiobuffer-to-wav';
import minimist from 'minimist';
import waveResampler from 'wave-resampler';

import { encode, decode, QPA_CONFIGS } from './qpa.js';

const QPA_SR = 5512.5;
const WAV_SR = 22050;

const argv = minimist(process.argv.slice(2));

if (argv._.length != 2)
    throw new Error(
        'usage:\n  node qpa_cli.js [-q <quality>] input.{qpa,wav,mp3,...} output.{qpa,wav}'
    );

const input = argv._[0];
const output = argv._[1];
const quality = argv.q ?? 2;
run(input, output);

function arrayToMonoAudioBuffer(array, sampleRate) {
    const buffer = new AudioBuffer({ length: array.length, sampleRate });
    buffer.copyToChannel(array, 0);
    return buffer;
}

function audioBufferToMonoArray(buffer) {
    const array = new Array(buffer.getChannelData(0).length).fill(0);
    for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channelData = buffer.getChannelData(i);
        for (let j = 0; j < buffer.length; j++) {
            array[j] += channelData[j];
        }
    }
    const norm = 1.0 / buffer.numberOfChannels;
    for (let i = 0; i < buffer.length; i++) {
        array[i] *= norm;
    }
    return array;
}

async function run(input, output) {
    const inFormat = path.extname(input).toLowerCase();
    const outFormat = path.extname(output).toLowerCase();

    const outFormats = ['.qpa', '.wav'];

    if (!outFormats.includes(outFormat)) {
        throw new Error('output format must be .wav or .qpa');
    }

    const inFile = await fs.readFile(input);
    let inAudioBuffer, outFile;

    if (inFormat == '.qpa') {
        inAudioBuffer = arrayToMonoAudioBuffer(decode(inFile), QPA_SR);
    } else {
        inAudioBuffer = await decodeAudio(inFile);
    }

    let inSamples = audioBufferToMonoArray(inAudioBuffer);
    if (outFormat == '.qpa') {
        if (inAudioBuffer.sampleRate !== QPA_SR) {
            inSamples = waveResampler.resample(
                inSamples,
                inAudioBuffer.sampleRate,
                QPA_SR,
                { method: 'sinc' }
            );
        }
        outFile = encode(inSamples, QPA_CONFIGS['qpa' + quality]);
    } else {
        if (inAudioBuffer.sampleRate !== WAV_SR) {
            // Use point resampling for closest possible approximation to PICO-8 behavior
            inSamples = waveResampler.resample(
                inSamples,
                inAudioBuffer.sampleRate,
                WAV_SR,
                { method: 'point' }
            );
        }
        outFile = new Uint8Array(
            encodeWAV(arrayToMonoAudioBuffer(inSamples, WAV_SR))
        );
    }
    if (outFile) {
        await fs.writeFile(output, outFile);
    } else {
        throw new Error('Failed to generate output file');
    }
}
