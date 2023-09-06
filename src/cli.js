#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import AudioBuffer from 'audio-buffer';
import decodeAudio from 'audio-decode';
import encodeWAV from 'audiobuffer-to-wav';
import minimist from 'minimist';
import waveResampler from 'wave-resampler';

import { encode, decode, QPA_CONFIGS, QPA_SR } from './qpa.js';

const WAV_SR = 22050;

const argv = minimist(process.argv.slice(2), {
    number: ['quality', 'effort'],
    boolean: ['verbose'],
    alias: { q: 'quality', v: 'verbose', e: 'effort' },
});

if (argv._.length != 2) {
    console.error(
        `Usage:  qpa-format [options] input.{qpa,wav,mp3,...} output.{qpa,wav}
    options:
        -q, --quality <q>       Set the quality level to <q>. Allowed values are 1-5, default is 2.
        -v, --verbose           Enable verbose mode.
        -e, --effort <n>        Sets encoder effort level. Allowed values are 0-1, default is 1.`
    );
} else {
    const input = argv._[0];
    const output = argv._[1];
    const quality = argv.q ?? 2;
    const verbosity = argv.v ? 1 : 0;
    const effort = argv.e ?? 1;
    run(input, output, quality, effort, verbosity);
}

function resampleAudioBuffer(inBuffer, outSR, options) {
    const resampledChannels = [];
    for (let i = 0; i < inBuffer.numberOfChannels; i++) {
        resampledChannels.push(
            waveResampler.resample(
                inBuffer.getChannelData(i),
                inBuffer.sampleRate,
                outSR,
                options
            )
        );
    }
    const outBuffer = new AudioBuffer({
        length: resampledChannels[0].length,
        sampleRate: outSR,
        numberOfChannels: inBuffer.numberOfChannels,
    });
    for (let i = 0; i < inBuffer.numberOfChannels; i++) {
        outBuffer.copyToChannel(resampledChannels[i], i);
    }
    return outBuffer;
}

async function run(input, output, quality, effort, verbosity) {
    const inFormat = path.extname(input).toLowerCase();
    const outFormat = path.extname(output).toLowerCase();

    const outFormats = ['.qpa', '.wav'];

    if (!outFormats.includes(outFormat)) {
        throw new Error('output format must be .wav or .qpa');
    }

    const inFile = await fs.readFile(input);
    let inAudioBuffer, outFile;

    if (inFormat == '.qpa') {
        inAudioBuffer = decode(inFile);
    } else {
        inAudioBuffer = await decodeAudio(inFile);
    }

    if (outFormat == '.qpa') {
        if (inAudioBuffer.sampleRate !== QPA_SR) {
            inAudioBuffer = resampleAudioBuffer(inAudioBuffer, QPA_SR, {
                method: 'sinc',
            });
        }
        outFile = encode(
            inAudioBuffer,
            QPA_CONFIGS['qpa' + quality],
            effort,
            verbosity > 0 ? (err) => console.log('err:', err) : () => undefined
        );
    } else {
        if (inAudioBuffer.sampleRate !== WAV_SR) {
            // Use point resampling for closest possible approximation to PICO-8 behavior
            inAudioBuffer = resampleAudioBuffer(inAudioBuffer, WAV_SR, {
                method: 'point',
            });
        }
        outFile = new Uint8Array(encodeWAV(inAudioBuffer));
    }
    if (outFile) {
        await fs.writeFile(output, outFile);
    } else {
        throw new Error('Failed to generate output file');
    }
}
