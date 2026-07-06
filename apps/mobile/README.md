# SkillProof Mobile (Flutter)

First-time setup (this repo ships only lib/ + pubspec; platform folders are generated):

```bash
flutter create . --platforms=android,ios
flutter pub get
flutter run
```

Notes:
- Android emulator reaches your machine's API at http://10.0.2.2:4000 (already configured in lib/api/client.dart).
- iOS simulator uses http://localhost:4000 — change baseUrl accordingly.
- Dev OTP is always 123456.
