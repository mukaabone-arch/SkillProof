# Mobile app — MOVED

The Flutter app no longer lives here.

**Actual location: `C:\projects\skillproof-mobile`** (Windows filesystem)

## Why

Gradle cannot build across the WSL/Windows filesystem bridge (`\\wsl$\...`).
It fails with `java.io.IOException: Incorrect function` from the FileHasher,
because the 9P protocol doesn't support the low-level file operations Gradle needs.

The project was moved to a native NTFS path so Gradle can build.

## Working with it

- Build/run from **PowerShell** at `C:\projects\skillproof-mobile`
- Claude Code (in WSL) can edit the files at `/mnt/c/projects/skillproof-mobile`
- It has its own git repo — it is not part of this monorepo
- Run against the API with:
  `flutter run -d <device> --dart-define=API_BASE_URL=http://<your-lan-ip>:4000`
- The API must bind to `0.0.0.0` and the Windows firewall must allow TCP 4000
