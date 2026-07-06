import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Thin API client mirroring apps/web/lib/api.ts.
/// Android emulator reaches your machine's localhost at 10.0.2.2.
class ApiClient {
  // TODO: move to --dart-define for real environments
  static const String baseUrl = 'http://10.0.2.2:4000';

  static Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('sp_token');
  }

  static Future<void> setToken(String? token) async {
    final prefs = await SharedPreferences.getInstance();
    if (token == null) {
      await prefs.remove('sp_token');
    } else {
      await prefs.setString('sp_token', token);
    }
  }

  static Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final token = await _token();
    final res = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      body: jsonEncode(body),
    );
    return _handle(res);
  }

  static Future<dynamic> get(String path) async {
    final token = await _token();
    final res = await http.get(
      Uri.parse('$baseUrl$path'),
      headers: {if (token != null) 'Authorization': 'Bearer $token'},
    );
    return _handle(res);
  }

  static dynamic _handle(http.Response res) {
    final body = res.body.isEmpty ? {} : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final msg = body is Map ? (body['message'] ?? 'Request failed') : 'Request failed';
      throw ApiException(msg.toString(), res.statusCode);
    }
    return body;
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  ApiException(this.message, this.statusCode);
  @override
  String toString() => message;
}
