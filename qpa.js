import { BitInputStream, BitOutputStream } from '@thi.ng/bitstream';

const QPA1_CONFIG = {
    slice_len: 28,
    scale_bits: 4,
    scale_exponent: 2,
    residual_bits: 1,
    dequant_tab: [0.125, -0.125],
    chunk_size: 7,
    update_shift: 3,
    predict_shift: 7,
    magic: 0x31617071 /* 'qpa1' */,
};

const QPA2_CONFIG = {
    slice_len: 14,
    scale_bits: 4,
    scale_exponent: 2,
    residual_bits: 2,
    dequant_tab: [0x10 / 256, -0x10 / 256, 0x40 / 256, -0x40 / 256],
    chunk_size: 4,
    update_shift: 3,
    predict_shift: 7,
    magic: 0x32617071 /* 'qpa2' */,
};

const QPA3_CONFIG = {
    slice_len: 10,
    scale_bits: 2,
    scale_exponent: 2,
    residual_bits: 3,
    dequant_tab: [
        0x60 / 256,
        -0x60 / 256,
        0x14b / 256,
        -0x14b / 256,
        0x28f / 256,
        -0x28f / 256,
        0x400 / 256,
        -0x400 / 256,
    ],
    chunk_size: 3,
    update_shift: 3,
    predict_shift: 7,
    magic: 0x33617071 /* 'qpa3' */,
};

const QPA4_CONFIG = {
    slice_len: 9,
    scale_bits: 5,
    scale_exponent: 2,
    residual_bits: 3,
    dequant_tab: [
        0x2 / 256,
        -0x2 / 256,
        0x8 / 256,
        -0x8 / 256,
        0xf / 256,
        -0xf / 256,
        0x18 / 256,
        -0x18 / 256,
    ],
    chunk_size: 3,
    update_shift: 3,
    predict_shift: 7,
    magic: 0x34617071 /* 'qpa4' */,
};

const QPA5_CONFIG = {
    slice_len: 7,
    scale_bits: 4,
    scale_exponent: 2,
    residual_bits: 4,
    dequant_tab: [
        0x6 / 256,
        -0x6 / 256,
        0x14 / 256,
        -0x14 / 256,
        0x24 / 256,
        -0x24 / 256,
        0x35 / 256,
        -0x35 / 256,
        0x47 / 256,
        -0x47 / 256,
        0x5a / 256,
        -0x5a / 256,
        0x6d / 256,
        -0x6d / 256,
        0.5,
        -0.5,
    ],
    chunk_size: 2,
    update_shift: 3,
    predict_shift: 7,
    magic: 0x35617071 /* 'qpa5' */,
};

export const QPA_CONFIGS = {
    qpa1: QPA1_CONFIG,
    qpa2: QPA2_CONFIG,
    qpa3: QPA3_CONFIG,
    qpa4: QPA4_CONFIG,
    qpa5: QPA5_CONFIG,
};

function pico_mul(a, b) {
    return Math.floor((a * b) / 65536) & 0xffffffff;
}

function to_pico(a) {
    return (a * 65536) & 0xffffffff;
}

function from_pico(a) {
    return a / 65536;
}

function make_scalefactor_tab(scale_bits, scale_exponent) {
    return Array(1 << scale_bits)
        .fill()
        .map((_, s) => Math.pow(s + 1, scale_exponent));
}

function expand_dequant_tab(raw_dequant_tab, scalefactor_tab) {
    return scalefactor_tab.map((sf) => {
        return raw_dequant_tab.map((dq) => {
            return pico_mul(to_pico(sf), to_pico(dq));
        });
    });
}

function qpa_clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

function swap_ends(inbuf) {
    const outbuf = new Uint8Array(inbuf.length);
    for (let i = 0; i < inbuf.length; i += 4) {
        outbuf[i + 0] = inbuf[i + 3];
        outbuf[i + 1] = inbuf[i + 2];
        outbuf[i + 2] = inbuf[i + 1];
        outbuf[i + 3] = inbuf[i + 0];
    }
    return outbuf;
}

class Encoder {
    constructor(samples, predict_shift, update_shift) {
        this.weights = new Int32Array(4);
        this.history = new Int32Array(4);
        this.error_dc = 0;
        this.signal_dc = 0;
        this.idx = 0;
        this.samples = samples;
        this.predict_shift = predict_shift;
        this.update_shift = update_shift;
        this.rms = 0;
        this.weights[2] = to_pico(-32);
        this.weights[3] = to_pico(64);
    }

    predict() {
        const weights = this.weights;
        const history = this.history;
        return (
            (pico_mul(weights[0], history[0]) +
                pico_mul(weights[1], history[1]) +
                pico_mul(weights[2], history[2]) +
                pico_mul(weights[3], history[3])) &
            0xffffffff
        );
    }

    update(residual, reconstructed) {
        const sample = this.samples[this.idx] * 128;
        const weights = this.weights;
        const history = this.history;
        const delta = residual >> this.update_shift;
        weights[0] += history[0] < 0 ? -delta : delta;
        weights[1] += history[1] < 0 ? -delta : delta;
        weights[2] += history[2] < 0 ? -delta : delta;
        weights[3] += history[3] < 0 ? -delta : delta;
        history[0] = history[1];
        history[1] = history[2];
        history[2] = history[3];
        history[3] = reconstructed >> this.predict_shift;
        this.signal_dc = (this.signal_dc + sample) * 0.5;
        const rms_sample = sample - 0.875 * this.signal_dc;
        this.rms += (rms_sample * rms_sample - this.rms) * (1 / 256);
        let error = from_pico(
            to_pico(sample + 128) - ((reconstructed + 0x7f0000) & 0xff0000)
        );

        this.error_dc = (this.error_dc + error) * 0.5;
        error -= 0.875 * this.error_dc;

        this.idx += 1;

        return (error * error) / (16 + this.rms);
    }

    clone_from(other) {
        const this_weights = this.weights;
        const this_history = this.history;
        const other_weights = other.weights;
        const other_history = other.history;
        this_weights[0] = other_weights[0];
        this_weights[1] = other_weights[1];
        this_weights[2] = other_weights[2];
        this_weights[3] = other_weights[3];
        this_history[0] = other_history[0];
        this_history[1] = other_history[1];
        this_history[2] = other_history[2];
        this_history[3] = other_history[3];
        this.error_dc = other.error_dc;
        this.signal_dc = other.signal_dc;
        this.idx = other.idx;
        this.rms = other.rms;
    }

    copy() {
        const new_enc = new Encoder(
            this.samples,
            this.predict_shift,
            this.update_shift
        );
        new_enc.clone_from(this);
        return new_enc;
    }

    samples_left() {
        return this.samples.length - this.idx;
    }
}

export function encode(data, config, err_cb) {
    const scalefactor_tab =
        config.scale_tab ??
        make_scalefactor_tab(config.scale_bits, config.scale_exponent);
    const dequant_tab = expand_dequant_tab(config.dequant_tab, scalefactor_tab);

    const num_samples = data.length;
    const num_slices = (num_samples + config.slice_len - 1) / config.slice_len;
    const enc = new Encoder(data, config.predict_shift, config.update_shift);
    const sf_enc = enc.copy();
    const best_sf_enc = enc.copy();
    const chunk_enc = enc.copy();
    const best_chunk_enc = enc.copy();

    const encoded_size =
        8 /* 8 byte file header */ + num_slices * 4; /* 4 byte slices */

    // write header
    const stream = new BitOutputStream(encoded_size);
    stream.write(config.magic, 32);
    stream.write(num_samples, 32);
    let error = 0;

    for (
        let sample_index = 0;
        sample_index < num_samples;
        sample_index += config.slice_len
    ) {
        const slice_len = qpa_clamp(
            config.slice_len,
            0,
            num_samples - sample_index
        );
        let best_sf_error = Infinity;
        let best_sf_slice;
        let best_sf_scale;

        for (
            let scalefactor = 0;
            scalefactor < scalefactor_tab.length;
            scalefactor++
        ) {
            const table = dequant_tab[scalefactor];
            sf_enc.clone_from(enc);
            let sf_error = 0;

            const slice = [];
            for (let i = 0; i < slice_len; i += config.chunk_size) {
                let best_chunk_error = Infinity;
                let best_chunk_quant;
                const chunk_size = Math.min(config.chunk_size, slice_len - i);
                const residual_mask = (1 << config.residual_bits) - 1;
                for (
                    let j = 0;
                    j < 1 << (config.residual_bits * chunk_size);
                    j++
                ) {
                    chunk_enc.clone_from(sf_enc);
                    let chunk_error = 0;
                    for (let k = 0; k < chunk_size; k++) {
                        const predicted = chunk_enc.predict();
                        const quant =
                            (j >> (k * config.residual_bits)) & residual_mask;
                        const dequantized = table[quant];
                        const reconstructed = qpa_clamp(
                            (predicted + dequantized) & 0xffffffff,
                            65536 * -128,
                            65536 * 127
                        );
                        chunk_error += chunk_enc.update(
                            dequantized,
                            reconstructed
                        );
                        if (chunk_error > best_chunk_error) {
                            break;
                        }
                    }
                    if (chunk_error < best_chunk_error) {
                        best_chunk_quant = j;
                        best_chunk_error = chunk_error;
                        best_chunk_enc.clone_from(chunk_enc);
                    }
                }
                if (best_chunk_error == Infinity) {
                    throw new Error('no best value found');
                }
                sf_error += best_chunk_error;
                if (sf_error > best_sf_error) {
                    break;
                }
                sf_enc.clone_from(best_chunk_enc);
                for (let k = 0; k < chunk_size; k++) {
                    const quant =
                        (best_chunk_quant >> (k * config.residual_bits)) &
                        residual_mask;
                    slice.push(quant);
                }
            }

            if (sf_error < best_sf_error) {
                best_sf_error = sf_error;
                best_sf_slice = slice;
                best_sf_scale = scalefactor;
                best_sf_enc.clone_from(sf_enc);
            }
        }
        if (best_sf_error == Infinity) {
            throw new Error('no best value found');
        }
        enc.clone_from(best_sf_enc);
        stream.write(best_sf_scale, config.scale_bits);
        for (let i = 0; i < config.slice_len; i++) {
            // the last slice of a file might be smaller
            const v = i < best_sf_slice.length ? best_sf_slice[i] : 0;
            stream.write(v, config.residual_bits);
        }
        error += best_sf_error;
    }
    if (err_cb) {
        err_cb(Math.sqrt(error / num_samples));
    }

    return swap_ends(stream.bytes());
}

export function decode(bytes, config_override) {
    const stream = new BitInputStream(swap_ends(bytes));
    const magic = stream.read(32);
    const num_samples = stream.read(32);
    const samples = new Float32Array(num_samples);

    const config =
        config_override ??
        Object.values(QPA_CONFIGS).find((c) => c.magic === magic);
    if (!config) {
        throw new Error('Could not find matching QPA config');
    }

    const scalefactor_tab =
        config.scale_tab ??
        make_scalefactor_tab(config.scale_bits, config.scale_exponent);
    const dequant_tab = expand_dequant_tab(config.dequant_tab, scalefactor_tab);

    const enc = new Encoder(
        new Array(num_samples).fill(0),
        config.predict_shift,
        config.update_shift
    );

    for (
        let sample_index = 0;
        sample_index < num_samples;
        sample_index += config.slice_len
    ) {
        const scalefactor = stream.read(config.scale_bits);
        const table = dequant_tab[scalefactor];
        const slice_start = sample_index;
        const slice_end = Math.min(
            sample_index + config.slice_len,
            num_samples
        );
        const slice_count = slice_end - slice_start;
        let idx = slice_start;
        let bitsRemaining = config.slice_len * config.residual_bits;
        // note: this loop is a hot code path and could be optimized
        for (let i = 0; i < slice_count; i++) {
            const predicted = enc.predict();
            const quantized = stream.read(config.residual_bits);
            const dequantized = table[quantized];
            const reconstructed = qpa_clamp(
                (predicted + dequantized) & 0xffffffff,
                65536 * -128,
                65536 * 127
            );
            enc.update(dequantized, reconstructed);
            samples[idx++] = from_pico(reconstructed) / 128;
            bitsRemaining -= config.residual_bits;
        }
        // skip stream if needed
        if (bitsRemaining > 0) {
            stream.read(bitsRemaining);
        }
    }

    return samples;
}
