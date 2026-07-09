import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import 'token_storage.dart';

class ApiException implements Exception {
  ApiException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => message;
}

/// REST client mirroring apps/web/lib/api.ts:
/// - attaches the stored access token as a Bearer header
/// - on a 401, attempts a single token refresh (rotating both tokens)
///   and retries the original request once
/// - if the refresh itself fails, clears the stored session and notifies
///   [onSessionExpired] so the UI can route back to the login screen
class ApiClient {
  ApiClient({http.Client? httpClient, TokenStorage? tokenStorage})
      : _http = httpClient ?? http.Client(),
        _tokens = tokenStorage ?? TokenStorage();

  final http.Client _http;
  final TokenStorage _tokens;

  /// Wired up by the auth controller; called when a refresh attempt is
  /// rejected by the server (expired/revoked refresh token).
  void Function()? onSessionExpired;

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body);

  void close() => _http.close();

  Future<dynamic> _send(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    var response = await _rawRequest(method, path, body);

    if (response.statusCode == 401 && await _tryRefresh()) {
      response = await _rawRequest(method, path, body);
    }

    return _decode(response);
  }

  Future<http.Response> _rawRequest(
    String method,
    String path,
    Map<String, dynamic>? body,
  ) async {
    final token = await _tokens.readAccessToken();
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    final headers = {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };

    switch (method) {
      case 'GET':
        return _http.get(uri, headers: headers);
      case 'POST':
        return _http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
      default:
        throw UnimplementedError('Unsupported method: $method');
    }
  }

  Future<bool> _tryRefresh() async {
    final refreshToken = await _tokens.readRefreshToken();
    if (refreshToken == null) return false;

    try {
      final response = await _http.post(
        Uri.parse('${ApiConfig.baseUrl}/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );

      if (response.statusCode >= 400) {
        // Refresh token expired or revoked server-side: the session is
        // over, not just this one request.
        await _tokens.clear();
        onSessionExpired?.call();
        return false;
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      // /auth/refresh rotates the refresh token too, so both must be
      // overwritten, not just the access token.
      await _tokens.saveTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      );
      return true;
    } catch (_) {
      // Network error: leave the session intact and let the original
      // 401 surface as a request failure.
      return false;
    }
  }

  dynamic _decode(http.Response response) {
    final decoded =
        response.body.isEmpty ? const <String, dynamic>{} : jsonDecode(response.body);
    if (response.statusCode >= 400) {
      final message = decoded is Map && decoded['message'] != null
          ? decoded['message'].toString()
          : 'Request failed (${response.statusCode})';
      throw ApiException(message, response.statusCode);
    }
    return decoded;
  }
}
