const path = require("node:path");

const outputDir = path.join(__dirname, "release");

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.smashdrums.editor",
  productName: "Smash Drums Editor",
  forceCodeSigning: false,
  directories: {
    output: outputDir,
  },
  files: ["dist/**/*", "electron/**/*", "package.json"],
  asar: true,
  linux: {
    target: [
      { target: "dir", arch: ["x64"] },
      { target: "AppImage", arch: ["x64"] },
    ],
    category: "AudioVideo",
    artifactName: "Smash-Drums-Editor-${version}-${arch}.${ext}",
    executableName: "smash-drums-editor",
  },
  win: {
    target: [
      {
        target: "portable",
        arch: ["x64"],
      },
    ],
    icon: "public/app-icon.ico",
    artifactName: "Smash-Drums-Editor-${version}-portable.exe",
    signAndEditExecutable: false,
  },
};
