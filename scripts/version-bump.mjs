// Runs on `npm version <x.y.z>`: copies the new version into manifest.json and adds it to versions.json,
// so the plugin manifest, versions.json and package.json always match the release tag.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.env.npm_package_version;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error(`Obsidian needs an x.y.z version, got "${version}"`);
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[version] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');
