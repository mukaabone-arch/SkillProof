import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ApplicantCard, { type ApplicantCardData } from './ApplicantCard';

function baseApplicant(overrides: Partial<ApplicantCardData> = {}): ApplicantCardData {
  return {
    applicationId: 'app-1',
    status: 'APPLIED',
    appliedAt: new Date().toISOString(),
    profileId: 'cand-1',
    fullName: 'Ada Lovelace',
    headline: 'Backend engineer',
    roleTitle: null,
    roleTitleOther: null,
    location: null,
    yearsOfExp: 5,
    githubUrl: null,
    linkedinUrl: null,
    hasPhoto: false,
    hasResume: false,
    hasPortfolio: false,
    profileIncomplete: false,
    score: null,
    verifiedSkills: [],
    externalCredentials: [],
    ...overrides,
  };
}

describe('ApplicantCard', () => {
  it('renders the display vocabulary (Practitioner), never the internal level code (L2)', () => {
    render(
      <ApplicantCard
        applicant={baseApplicant({
          verifiedSkills: [
            { skillId: 's1', skillName: 'Feature Engineering', level: 'L2', verifiedBy: 'TEST', verifyHash: 'h1' },
          ],
        })}
      />,
    );

    expect(screen.getByText(/Feature Engineering \(Practitioner\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(L2\)/)).not.toBeInTheDocument();
  });

  it('renders a match band, not a raw score', () => {
    render(<ApplicantCard applicant={baseApplicant({ score: 90 })} />);

    expect(screen.getByText('Strong match')).toBeInTheDocument();
    expect(screen.queryByText('90')).not.toBeInTheDocument();
  });

  it('does not render score/band at all when there is no single job to score against', () => {
    render(<ApplicantCard applicant={baseApplicant({ score: null })} />);

    expect(screen.queryByText(/match/i)).not.toBeInTheDocument();
  });
});
