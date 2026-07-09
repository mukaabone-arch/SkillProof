# SkillProof Mobile (Flutter)

Candidate-facing app: auth, profile, jobs, applications, badges. Assessments
stay on web — not built natively.

This repo ships only `lib/` + `pubspec.yaml`; platform folders (`android/`,
`ios/`) are generated locally, not committed.

## First-time setup (run from PowerShell on Windows, Flutter is not available in WSL)

```powershell
cd apps\mobile
flutter create . --platforms=android,ios --org com.flairfuture --project-name skillproof
flutter pub get
flutter run
```

`--project-name skillproof` must match the `name:` field already in
`pubspec.yaml`, or `flutter create` will refuse to run. Combined with
`--org com.flairfuture`, this produces:

- Android `applicationId`: `com.flairfuture.skillproof`
- iOS bundle id: `com.flairfuture.skillproof`

`flutter create .` on a directory that already has `lib/` and `pubspec.yaml`
only fills in the missing platform folders — it will not overwrite the
existing Dart source.

## Running against the API

The API base URL is one constant, `ApiConfig.baseUrl` in
`lib/config/api_config.dart`, defaulting to `http://10.0.2.2:4000` (the
Android emulator's alias for the host machine's `localhost`, where
`apps/api` runs — see `docker-compose.yml` / `apps/api`).

Override it per-run instead of editing the constant:

```powershell
# Android emulator (default, no override needed)
flutter run

# iOS simulator
flutter run --dart-define=API_BASE_URL=http://localhost:4000

# Physical device on the same LAN (replace with your machine's IP)
flutter run --dart-define=API_BASE_URL=http://192.168.1.50:4000
```

Dev OTP is always `123456` (the API mints that fixed code whenever
`NODE_ENV != production`).

## State management: Riverpod

Chose Riverpod over Bloc for this foundation:

- `AuthController` (a `StateNotifier<AuthState>`) is the only piece of
  app-wide state so far; Riverpod's `Provider`/`StateNotifierProvider` give
  that without the ceremony of Bloc's event classes for what is currently a
  handful of methods (`requestOtp`, `verifyOtp`, `logout`).
- No `BuildContext` needed to read state (`ref.read`/`ref.watch`), which
  keeps `ApiClient` and `AuthRepository` plain Dart classes, easy to unit
  test in isolation.
- Providers compose cleanly as the app grows (`apiClientProvider` →
  `authRepositoryProvider` → `authControllerProvider`), which should extend
  fine to `jobsProvider`, `applicationsProvider`, etc. without restructuring.

## Structure

```
lib/
  main.dart                        ProviderScope + app entrypoint
  app.dart                         MaterialApp; routes on AuthState
  config/
    api_config.dart                ApiConfig.baseUrl — the one place the API URL is defined
  core/
    token_storage.dart             flutter_secure_storage wrapper (access + refresh tokens)
    api_client.dart                HTTP client: auth header, 401 -> refresh -> retry once
    providers.dart                 tokenStorageProvider, apiClientProvider
  models/
    user.dart                      SkillProofUser
  features/
    auth/
      auth_repository.dart         /auth/otp/request, /auth/otp/verify, /auth/logout, /users/me
      auth_state.dart              AuthInitial / AuthLoading / AuthAuthenticated / AuthUnauthenticated
      auth_controller.dart         StateNotifier driving auth_state + session restore on launch
      login_screen.dart            Phone -> OTP -> verify
    home/
      home_screen.dart             Placeholder: shows signed-in phone, logout
```

## Auth flow

1. `LoginScreen` posts `{ phone }` to `POST /auth/otp/request`.
2. User enters the OTP, `LoginScreen` posts `{ phone, otp }` to
   `POST /auth/otp/verify`, which returns `{ accessToken, refreshToken, user }`.
3. `AuthController` stores both tokens via `TokenStorage` (Keystore/Keychain)
   and flips state to `AuthAuthenticated`; `SkillProofApp` swaps to
   `HomeScreen` automatically — no manual `Navigator` call needed.
4. Every subsequent `ApiClient.get`/`post` attaches
   `Authorization: Bearer <accessToken>`. On a `401`, the client posts
   `{ refreshToken }` to `POST /auth/refresh` once, stores the *rotated*
   pair it gets back, and retries the original request. If the refresh
   itself is rejected, tokens are cleared and the app falls back to
   `LoginScreen`.
5. On app relaunch, `AuthController` checks `TokenStorage` for a stored
   access token and calls `GET /users/me` to restore the session (this also
   exercises the refresh path if the access token has expired since last
   launch).
6. Logout posts `{ refreshToken }` to `POST /auth/logout` (best-effort) and
   always clears local storage.

## Not built yet

Profile, jobs, applications, badges — foundation only for now, per scope.
