import '../../core/api_client.dart';
import '../../core/token_storage.dart';
import '../../models/user.dart';

/// Talks to the /auth and /users/me endpoints. Field names below must
/// match the API's DTOs exactly — a global ValidationPipe with
/// forbidNonWhitelisted rejects any request body with extra fields.
class AuthRepository {
  AuthRepository({required this.apiClient, required this.tokenStorage});

  final ApiClient apiClient;
  final TokenStorage tokenStorage;

  Future<void> requestOtp(String phone) async {
    await apiClient.post('/auth/otp/request', {'phone': phone});
  }

  Future<SkillProofUser> verifyOtp({
    required String phone,
    required String otp,
  }) async {
    final response = await apiClient.post('/auth/otp/verify', {
      'phone': phone,
      'otp': otp,
    }) as Map<String, dynamic>;

    await tokenStorage.saveTokens(
      accessToken: response['accessToken'] as String,
      refreshToken: response['refreshToken'] as String,
    );

    return SkillProofUser.fromJson(response['user'] as Map<String, dynamic>);
  }

  Future<SkillProofUser> fetchMe() async {
    final response = await apiClient.get('/users/me') as Map<String, dynamic>;
    return SkillProofUser.fromJson(response);
  }

  Future<void> logout() async {
    final refreshToken = await tokenStorage.readRefreshToken();
    if (refreshToken != null) {
      try {
        await apiClient.post('/auth/logout', {'refreshToken': refreshToken});
      } catch (_) {
        // Best-effort server-side revoke; the local session is cleared
        // regardless of whether this call succeeds.
      }
    }
    await tokenStorage.clear();
  }

  Future<bool> hasStoredSession() async {
    return (await tokenStorage.readAccessToken()) != null;
  }
}
