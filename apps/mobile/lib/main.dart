import 'package:flutter/material.dart';
import 'screens/login_screen.dart';

void main() => runApp(const SkillProofApp());

class SkillProofApp extends StatelessWidget {
  const SkillProofApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SkillProof',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF3240B8)),
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}
