import 'package:flutter/material.dart';
import '../api/client.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _me;
  List<dynamic> _taxonomy = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final me = await ApiClient.get('/users/me');
      final tax = await ApiClient.get('/taxonomy');
      setState(() {
        _me = me as Map<String, dynamic>;
        _taxonomy = tax as List<dynamic>;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('SkillProof')),
      body: _error != null
          ? Center(child: Text(_error!))
          : _me == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text('Signed in as ${_me!['phone']}',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 24),
                    Text('Skill domains',
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 8),
                    for (final domain in _taxonomy)
                      Card(
                        child: ExpansionTile(
                          title: Text(domain['name'] as String),
                          children: [
                            for (final skill in (domain['skills'] as List))
                              ListTile(
                                dense: true,
                                title: Text(skill['name'] as String),
                                trailing: const Icon(Icons.chevron_right),
                                // TODO: navigate to assessment list for skill
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
    );
  }
}
