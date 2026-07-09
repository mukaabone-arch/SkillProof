/// API connection settings for the SkillProof backend.
class ApiConfig {
  ApiConfig._();

  /// Override at build/run time, e.g.:
  ///   flutter run --dart-define=API_BASE_URL=http://192.168.1.50:4000
  ///
  /// Default is the Android emulator's alias for the host machine's
  /// localhost. iOS simulator should use http://localhost:4000; a
  /// physical device needs your machine's LAN IP.
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );
}
