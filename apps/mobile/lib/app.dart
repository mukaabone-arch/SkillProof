import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/auth/auth_controller.dart';
import 'features/auth/auth_state.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_screen.dart';

/// Navigation is state-driven off [authControllerProvider] rather than a
/// router: the whole app only has two destinations for now (login, home),
/// and the auth state already models exactly when each applies.
class SkillProofApp extends ConsumerWidget {
  const SkillProofApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);

    return MaterialApp(
      title: 'SkillProof',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF3240B8)),
        useMaterial3: true,
      ),
      home: switch (authState) {
        AuthAuthenticated() => const HomeScreen(),
        AuthInitial() || AuthLoading() => const _SplashScreen(),
        AuthUnauthenticated() => const LoginScreen(),
      },
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
