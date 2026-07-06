import 'package:flutter/material.dart';
import '../api/client.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneCtrl = TextEditingController(text: '+91');
  final _otpCtrl = TextEditingController();
  bool _otpSent = false;
  bool _loading = false;
  String? _error;

  Future<void> _requestOtp() async {
    setState(() { _loading = true; _error = null; });
    try {
      await ApiClient.post('/auth/otp/request', {'phone': _phoneCtrl.text.trim()});
      setState(() => _otpSent = true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _verify() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.post('/auth/otp/verify', {
        'phone': _phoneCtrl.text.trim(),
        'otp': _otpCtrl.text.trim(),
      });
      await ApiClient.setToken(res['accessToken'] as String);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const HomeScreen()),
      );
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 48),
              Text('SkillProof',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      )),
              const SizedBox(height: 8),
              Text('Verify your AI skills. Get hired on proof.',
                  style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 40),
              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                enabled: !_otpSent,
                decoration: const InputDecoration(
                  labelText: 'Phone number',
                  border: OutlineInputBorder(),
                ),
              ),
              if (_otpSent) ...[
                const SizedBox(height: 16),
                TextField(
                  controller: _otpCtrl,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  decoration: const InputDecoration(
                    labelText: 'OTP (123456 in dev)',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _loading ? null : (_otpSent ? _verify : _requestOtp),
                child: Text(_loading
                    ? 'Please wait…'
                    : (_otpSent ? 'Verify OTP' : 'Send OTP')),
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
