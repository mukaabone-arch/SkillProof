import '../../models/user.dart';

sealed class AuthState {
  const AuthState();
}

/// App just launched; session hasn't been checked yet.
class AuthInitial extends AuthState {
  const AuthInitial();
}

/// Restoring a stored session, or an OTP verify is in flight.
class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(this.user);

  final SkillProofUser user;
}

class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated({this.error});

  final String? error;
}
