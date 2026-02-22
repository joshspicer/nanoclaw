import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('voice-transcription skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    expect(content).toContain('skill: voice-transcription');
    expect(content).toContain('version: 1.0.0');
    expect(content).toContain('openai');
    expect(content).toContain('OPENAI_API_KEY');
  });

  it('has all files declared in adds', () => {
    const transcriptionFile = path.join(skillDir, 'add', 'src', 'transcription.ts');
    expect(fs.existsSync(transcriptionFile)).toBe(true);

    const content = fs.readFileSync(transcriptionFile, 'utf-8');
    expect(content).toContain('transcribeAudioMessage');
    expect(content).toContain('isVoiceMessage');
    expect(content).toContain('transcribeWithOpenAI');
    expect(content).toContain('downloadMediaMessage');
    expect(content).toContain('readEnvFile');
  });

  it('has no WhatsApp overlay files (WhatsApp removed)', () => {
    const modifyDir = path.join(skillDir, 'modify');
    // The WhatsApp overlay files were removed when WhatsApp was dropped
    expect(fs.existsSync(modifyDir)).toBe(false);
  });
});
