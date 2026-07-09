class SkillProofUser {
  SkillProofUser({
    required this.id,
    required this.role,
    this.phone,
    this.email,
  });

  factory SkillProofUser.fromJson(Map<String, dynamic> json) => SkillProofUser(
        id: json['id'] as String,
        role: json['role'] as String? ?? 'CANDIDATE',
        phone: json['phone'] as String?,
        email: json['email'] as String?,
      );

  final String id;
  final String role;
  final String? phone;
  final String? email;
}
