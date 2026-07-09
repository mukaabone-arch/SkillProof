import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../auth/auth_state.dart';

/// Placeholder landing screen. Profile, jobs, applications and badges
/// are built out separately — this only proves the auth foundation:
/// a signed-in candidate and their phone number from GET /users/me.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(authControllerProvider);
    final phone = state is AuthAuthenticated ? state.user.phone : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('SkillProof'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Log out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: Center(
        child: Text(
          phone != null ? 'Signed in as $phone' : 'Signed in',
          style: Theme.of(context).textTheme.titleMedium,
        ),
      ),
    );
  }
}
