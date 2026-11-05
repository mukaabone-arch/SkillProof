import type { Metadata } from 'next';
import Link from 'next/link';
import LegalDocument from '@/components/landing/LegalDocument';

export const metadata: Metadata = { title: 'Terms of Service · MyAmbii' };

/**
 * Real Terms of Service content, replacing the LegalStub placeholder — see
 * LegalDocument.tsx for the shared header/column chrome, and PrivacyPage for
 * the same rendering approach. Transcribed from terms-of-service-content.md
 * verbatim: no clause is reworded, condensed, or corrected.
 *
 * This source document is structurally messier than the Privacy Policy and
 * required a few transcription judgment calls, flagged in the PR description
 * rather than silently resolved:
 *   - The numbered sections in source are 1, 2, 3, 7, 8, 12 — not
 *     sequential. Rendered exactly as numbered; nothing is renumbered and no
 *     placeholder sections were invented to fill 4-6 or 9-11.
 *   - A long unnumbered preamble (Purpose / Use to be in conformity with the
 *     Purpose / the a-x "shall not" list / Step-up security application /
 *     payment & jurisdiction clauses) precedes the numbered sections. Its
 *     two bold ALL-CAPS labels became h2s; the ALL-CAPS *clause* text further
 *     down (THE USER REPRESENTS..., BY ACCEPTING..., BY COMPLETING...) is
 *     emphasis on the clause itself, not a heading, so it stays inline
 *     <strong> text rather than becoming another h2.
 *   - Section "1." heading text in source runs directly into its lead-in
 *     sentence with no line break ("...Resume Manager by registering your
 *     resume on MyAmbii.com, you agree to the following terms"), unlike
 *     every sibling section header. Split into a heading + a separate lead
 *     sentence (capitalizing "By") to match the other five numbered
 *     sections' own pattern — the only place a capitalization was added
 *     rather than transcribed verbatim.
 *   - "The user of MyAmbii.com is subject to the Privacy Policy available
 *     through this link" names a link without markup in source; pointed at
 *     this app's real /privacy route rather than left as dead prose,
 *     matching how §4 of the Privacy Policy anchors to its own Cookie
 *     Policy.
 */
export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" lastUpdated="15 August 2026">
      <h2>PURPOSE:</h2>
      <p>
        MyAmbii.com is intended only to serve as a preliminary medium of contact and exchange of information for
        its users / members / visitors who have a bona fide intention to contact and/or be contacted for the
        purposes related to genuine existing job vacancies and for other career enhancement services.
      </p>

      <h2>USE TO BE IN CONFORMITY WITH THE PURPOSE</h2>
      <p>
        MyAmbii.com (and related products) or service or product that is subscribe to or used (whether the same is
        paid for by you or not) is meant for the Purpose <strong>and only the exclusive use of the
        subscriber/registered user.</strong> Copying or downloading or recreating or sharing passwords or
        sublicensing or sharing in any manner which is not in accordance with these terms, <strong>is a
        misuse</strong> of the platform or service or product and Mukaab Technologies Private Ltd. (MTPL) reserves
        its rights to act in such manner as to protect its loss of revenue or reputation or claim damages including
        stopping your service or access and reporting to relevant authorities. In the event you are found to be
        copying or misusing or transmitting or crawling any data or photographs or graphics or any information
        available on MyAmbii.com for any purpose other than that being a bonafide Purpose, we reserve the right to
        take such action that we deem fit including stopping access and claiming damages.
      </p>
      <p>
        The site is a public site with free access and MTPL assumes no liability for the quality and genuineness of
        responses. MTPL cannot monitor the responses that a person may receive in response to information he/she
        has displayed on the site. The individual/company would have to conduct its own background checks on the
        bonafide nature of all response(s).
      </p>
      <p>
        You give us permission to use the information about actions that you have taken on MyAmbii.com in
        connection with ads, offers and other content (whether sponsored or not) that we display across our
        services, without any compensation to you. We use data and information about you to make relevant
        suggestions and recommendation to you and others.
      </p>
      <p>
        The platform may contain links to third party websites, these links are provided solely as convenience to
        You and the presence of these links should not under any circumstances be considered as an endorsement of
        the contents of the same, if You chose to access these websites you do so at your own risk.
      </p>
      <p>
        Whilst using this platform an obligation is cast upon you to only provide true and correct information and
        in the case of creating a profile you undertake to at all times keep the information up to date. MTPL will
        not be liable on account of any inaccuracy of information on this web site. It is the responsibility of the
        visitor to further research the information on the site. Any breach of privacy or of the information
        provided by the consumer to MTPL to be placed on the website by technical or any other means is not the
        responsibility of MTPL MTPL does not guarantee confidentiality of information provided to it by any person
        acquiring/using all/any information displayed on the MyAmbii.com website or any of its other websites /
        domains owned and operated by MTPL Private Ltd..
      </p>
      <p>
        MTPL does not share personally identifiable data of any individual with other companies / entities without
        obtaining permission except with those acting as our agents.. MTPL shall share all such information that it
        has in its possession in response to legal process, such as a court order or subpoena. The user shall not
        utilize the services offered by MyAmbii.com/MTPL in any manner so as to impair the interests and functioning
        of MyAmbii.com/MTPL. The user undertakes not to duplicate, download publish, modify and distribute material
        on MyAmbii.com unless specifically authorized by MTPL in this regard.
      </p>
      <p>
        The user undertakes to use MyAmbii.com for his/her own purposes. Using content from MyAmbii.com for
        derivative works with a commercial motive without prior written consent from MTPL is strictly prohibited.
      </p>
      <p>
        Users undertake that the services offered by MyAmbii.com/ MTPL shall not be utilized to upload, post,
        email, transmit or otherwise make available either directly or indirectly, any unsolicited bulk e-mail or
        unsolicited commercial e-mail. MTPL reserves the right to filter and monitor and block the emails sent by
        you/user using the servers maintained by MTPL to relay emails. All attempts shall be made by MTPL and the
        user to abide by International Best Practices in containing and eliminating Spam.
      </p>
      <p>
        Users shall not spam the platform maintained by MyAmbii.com / MTPL or indiscriminately and repeatedly post
        jobs/forward mail indiscriminately etc. Any conduct of the user in violation of this clause shall entitle
        MTPL to forthwith terminate all services to the user without notice and to forfeit any amounts paid by him.
      </p>
      <p>
        The user shall not upload, post, transmit, publish, or distribute any material or information that is
        unlawful, or which may potentially be perceived as being harmful, threatening, abusive, harassing,
        defamatory, libelous, vulgar, obscene, or racially, ethnically, or otherwise objectionable.
      </p>
      <p>
        The user expressly states that the resume/insertion or information/ data being fed into the network of MTPL
        by the user is correct and complete in all respects and does not contain any false, distorted, manipulated,
        fraudulent or misleading facts or averments. MTPL expressly disclaims any liability arising out of the said
        resume insertion/information/ data so fed into the network of MTPL by the user. Further, the user agrees to
        indemnify MTPL for all losses incurred by MTPL due to any false, distorted, manipulated, defamatory,
        libelous, vulgar, obscene, fraudulent or misleading facts or otherwise objectionable averments made by the
        user on the network of MTPL .
      </p>
      <p>
        The User is solely responsible for maintaining confidentiality of the User password and user identification
        and all activities and transmission performed by the User through his user identification and shall be
        solely responsible for carrying out any online or off-line transaction involving credit cards / debit cards
        or such other forms of instruments or documents for making such transactions and MTPL assumes no
        responsibility or liability for their improper use of information relating to such usage of credit cards /
        debit cards used by the subscriber online / off-line.
      </p>
      <p>
        The User/Subscriber/Visitor to MyAmbii.com and/or its affiliated websites does hereby specifically agree
        that he/she shall, at all times, comply with the requirements of the Information Technology Act, 2000 as
        also rules, regulations, guidelines, bye laws and notifications made thereunder, while assessing or feeding
        any resume/ insertion or information/data into the computers, computer systems or computer network of MTPL
        . The said User/ subscriber/ visitor to MyAmbii.com and/or its affiliated websites does further
        unequivocally declare that in case he violates any provisions of the Information Technology Act, 2000
        and/or rules, regulations, guidelines, byelaws and notifications made thereunder, he shall alone be
        responsible for all his acts, deeds and things and that he alone shall be liable for civil and criminal
        liability there under or under any other law for the time being in force.
      </p>
      <p>
        The User is solely responsible for obtaining, at his own cost, all licenses, permits, consents, approvals
        and intellectual property or other rights as may be required by the user for using the Service.
      </p>
      <p>
        <strong>THE USER REPRESENTS, WARRANTS AND COVENANTS THAT ITS USE OF MYAMBII.COM SHALL NOT BE DONE IN A
        MANNER SO AS TO:</strong>
      </p>
      <ol type="a">
        <li>
          Access the Platform for purposes of extracting content to be used for training a machine learning or AI
          model, without the express prior written permission.
        </li>
        <li>Violate any applicable local, provincial, state, national or international law, statute, ordinance, rule or regulation;</li>
        <li>Interfere with or disrupt computer networks connected to MyAmbii.com;</li>
        <li>
          Impersonate any other person or entity, or make any misrepresentation as to your employment by or
          affiliation with any other person or entity;
        </li>
        <li>Forge headers or in any manner manipulate identifiers in order to disguise the origin of any user information;</li>
        <li>Interfere with or disrupt the use of MyAmbii.com by any other user, nor &quot;stalk&quot;, threaten, or in any manner harass another user;</li>
        <li>Use MyAmbii.com in such a manner as to gain unauthorized entry or access to the computer systems of others;</li>
        <li>
          Reproduce, copy, modify, sell, store, distribute or otherwise exploit for any commercial purposes
          MyAmbii.com, or any component thereof (including, but not limited to any materials or information
          accessible through MyAmbii.com);
        </li>
        <li>Use content from the Site for derivative works with a commercial motive without prior written consent of the MTPL.</li>
        <li>Use any device, software or routine to interfere or attempt to interfere with the proper working of MyAmbii.com; or</li>
        <li>Impose an unreasonable or disproportionately large load on MyAmbii.com infrastructure.</li>
        <li>Spam MyAmbii.com/MTPL by indiscriminately and repeatedly posting content or forwarding mail that may be considered spam etc.</li>
        <li>Access data not intended for you or log into server or account that you are not authorized to access;</li>
        <li>
          Constitute an act of reverse engineering, decompiling, disassembling, deciphering or otherwise attempting
          to derive the source code for the Site or any related technology or any part thereof
        </li>
        <li>Engage in &quot;framing,&quot; &quot;mirroring,&quot; or otherwise simulating the appearance or function of the Site</li>
        <li>Attempt to probe, scan or test the vulnerability of a system or network;</li>
        <li>Use automated means to crawl and/or scrape content from MyAmbii.com and to manually scrape content from MyAmbii.com;</li>
        <li>The Site uses technological means to exclude Robots etc. from crawling it and scraping content. You undertake not to circumvent these methods.</li>
        <li>Access the Site except through the interfaces expressly provided by MTPL;</li>
        <li>Attempt or breach security or authentication measures without proper authorization;</li>
        <li>
          Providing deeplinks into MyAmbii.com without prior permission of MTPL is prohibited. Extracting data from
          MyAmbii.com using any automated process such as spiders, crawlers etc. or through any manual process for a
          purpose which has not been authorised in writing.
        </li>
        <li>Upload, post, email, transmit or otherwise make available either directly or indirectly, any unsolicited bulk e-mail or unsolicited commercial e-mail.</li>
        <li>Subscribers shall under no circumstance sublicense, assign, or transfer the License, and any attempt at such sublicense, assignment or transfer is void.</li>
        <li>
          Constitute hosting, modifying, uploading, posting, transmitting, publishing, or distributing any material
          or information
          <ol type="a">
            <li>For which you do not have all necessary rights and licenses;</li>
            <li>
              Which infringes, violates, breaches or otherwise contravenes the rights of any third party, including
              any copyright, trademark, patent, rights of privacy or publicity or any other proprietary right;
            </li>
            <li>
              Which contains a computer virus, or other code, files or programs intending in any manner to disrupt
              or interfere with the functioning of MyAmbii.com, or that of other computer systems;
            </li>
            <li>
              That is grossly harmful, harassing, invasive of another&apos;s privacy, hateful, disparaging, relating
              to money laundering or unlawful, or which may potentially be perceived as being harmful, threatening,
              abusive, harassing, defamatory, libelous/blasphemous, vulgar, obscene, or racially, ethnically, or
              otherwise unlawful in any manner whatsoever;
            </li>
            <li>Which constitutes or encourages conduct that would constitute a criminal offence, give rise to other liability, or otherwise violate applicable law;</li>
            <li>That deceives or misleads the addressee about the origin of such messages or communicates any information which is grossly offensive or menacing in nature;</li>
            <li>That belongs to another person and to which the user does not have any right to;</li>
            <li>That harm minors in any way;</li>
            <li>
              That threatens the unity, integrity, defence, security or sovereignty of India, friendly relations
              with foreign states, or public order or causes incitement to the commission of any cognisable offence
              or prevents investigation of any offence or is insulting any other nation.
            </li>
          </ol>
        </li>
      </ol>
      <p>
        The user shall not infringe on any intellectual property rights of any person / entity or retain
        information / download any information from any computer system or otherwise with an intention to do so.
      </p>
      <p>
        MTPL will make best efforts to do so but does not warrant that any of the web sites or any affiliate
        site(s) or network system linked to it is free of any operational errors nor does it warrant that it will
        be free of any virus, computer contaminant, worm, or other harmful components. The subscription of a user
        shall be subject to Quotas as applicable and as advised. E-Mails provided as part of contact details are
        expected to be genuine and access to such email accounts is available to authorised personnel only.
      </p>
      <p>
        The CLIENT agrees to use only email addresses associated with a domain name officially owned by the CLIENT
        or BENEFICIARY EMPLOYER for its authorized user(s) when registering sub-users or conducting activities on
        their MyAmbii account, including sending emails and posting jobs. The use of non-official domains is
        strictly prohibited. MyAmbii reserves the right to suspend or terminate services if this condition is
        violated.
      </p>

      <h2>Step-up security application</h2>
      <p>
        To protect your account and our services, we use automated systems and manual checks to detect unusual
        activity or outlier behavior. If we identify elevated risk, we may require additional verification. In some
        cases, you will be asked to install our application on your device to complete verification and regain
        access. We will inform you in-app or by email/SMS when installation of the application is required, and
        request your consent to install and grant permissions. If you decline, your access to some or all features
        may be limited until an alternative verification is completed. The application might require additional
        authentication may include biometric, photo verification, SMS authentication, and others. We may share
        limited data with service providers that help deliver the fraud prevention and security checks. If you feel
        access to your account is limited or denied based on automated processing, you may request human review and
        contest the decision by contacting our support team, the decision of MTPL post a human review will be final
        and binding. You agree to install updates to the application when prompted, keep your device OS up to date,
        and not interfere with the Platforms security features. SMS authentication: By registering or logging in,
        you authorize MyAmbii.com to send you one-time verification codes and other security-related transactional
        messages by SMS to the mobile number linked to your log in/account. Message and data rates may apply.
        Message frequency varies by your use. Delivery is not guaranteed and may be delayed or prevented by your
        carrier or network conditions. To streamline login, the MyAmbii.com application may request permission on
        your device to read the verification codes we send to you. We process your phone number, OTP verification
        data, and related technical logs to authenticate you, prevent fraud, and secure your account. You represent
        that you are the current owner and authorized user of the mobile number provided and will promptly update
        it if it changes. You are responsible for securing your device and SIM. Do not share verification codes
        with anyone. SMS delivery may be delayed or fail due to factors outside our control. Message and data rates
        may apply. Carriers are not liable for delayed or undelivered messages. We may suspend or restrict access,
        or require additional verification, if we detect or suspect fraud, SIM swap, or unauthorized use.
      </p>
      <p>
        MTPL shall not be liable for any loss or damage sustained by reason of any disclosure (inadvertent or
        otherwise) of any information concerning the user&apos;s account and / or information relating to or
        regarding online transactions using credit cards / debit cards and / or their verification process and
        particulars nor for any error, omission or inaccuracy with respect to any information so disclosed and used
        whether or not in pursuance of a legal process or otherwise.
      </p>
      <p>
        Payments for the services offered by MyAmbii.com shall be on a 100% advance basis. Refund if any will be at
        the sole discretion of MTPL . MTPL offers no guarantees whatsoever for the accuracy or timeliness of the
        refunds reaching the Customers card/bank accounts. MTPL gives no guarantees of server uptime or
        applications working properly. All is on a best effort basis and liability is limited to refund of amount
        only. MTPL undertakes no liability for free services. MTPL reserves its right to amend / alter or change
        all or any disclaimers or terms of agreements at any time without any prior notice. All terms /
        disclaimers whether specifically mentioned or not shall be deemed to be included if any reference is made
        to them.
      </p>
      <p>
        Where the <em>bill-to, ship-to,</em> and/or <em>paying</em> customer are different entities (for the
        purposes of this clause collectively, the &quot;Customers&quot;), each Customer jointly and severally
        represents and warrants that they have a valid and lawful internal arrangement authorizing their engagement
        with MTPL. Each Customer agrees to fully indemnify and hold the Company harmless from any claims or
        liabilities arising from such inter-se arrangements.
      </p>
      <p>Each Customer shall promptly provide all required KYC documents of any or all Customers upon the Company&apos;s request.</p>
      <p>
        This contract shall be deemed accepted-without further act or communication-within one working day of: (a)
        the invoice date for the <em>bill-to</em> customer; (b) the payment date for the <em>paying</em> customer;
        and (c) subscription activation for the <em>ship-to</em> customer, unless a written objection is submitted
        to the Company&apos;s finance team within that period.
      </p>
      <p>
        Unless otherwise specified and notwithstanding anything contained in any other agreement or arrangement, by
        whatever name called, the performance obligation of MTPL (service provider) is to provide access of its
        on-line portal to the customer for the duration of the subscription period &amp; reference to any usage, by
        whatever name called or any other performance obligation, if any, is to provide the upper limit for
        consumption, which by itself, does not create any additional performance obligation upon MTPL.
      </p>
      <p>
        Subscriber/user acknowledges and agrees that MTPL/MyAmbii.com, at its sole discretion and without prejudice
        to other rights and remedies that it may have under the applicable laws, shall be entitled to set off the
        amount paid or payable by a subscriber/user against any amount(s) payable by Subscriber/user to MTPL under
        any other agreement or commercial relationship towards other products/services.
      </p>
      <p>
        MTPL further reserves its right to post the data on the website MyAmbii.com or on such other affiliated
        sites and publications as MTPL may deem fit and proper at no extra cost to the subscriber / user.
      </p>
      <p>
        The subscription / agreement between MTPL and the subscriber / user is not a &quot;non-poach
        agreement&quot; nor can the same be termed or used as an alternative to &quot;non-poach agreement&quot; in
        as much as MTPL / MyAmbii.com is a public site and all information posted by MTPL goes to the public domain
        except information / data which is specifically assigned a non-public / private character.
      </p>
      <p>Any agreement for a subscription / usage entered into by MTPL does not confer exclusivity of service on any subscriber / user.</p>
      <p>
        MTPL Private Ltd. will not be party to any legal proceedings between a user (e.g. a subscriber) and a party
        contracted through the site. In case MTPL is implicated in any legal proceedings, costs will be recovered
        from the party that names MTPLMTPL however will abide with any court order served on it through due
        process. MTPL controls and operates this Platform from its headquarters in Noida and makes no
        representation that the materials on MyAmbii.com are appropriate or available for use in other locations.
        If you use this Website from other locations, you are responsible for compliance with applicable local laws
        including but not limited to the export and import regulations of other countries.
      </p>
      <p>
        In case a person using the world wide web/internet receives a spam or virus which includes a link to
        MyAmbii.com or to any other site maintained, operated or owned by MTPL, it should not be held responsible
        for the same. MTPL assumes no responsibility for such mails.
      </p>
      <p>
        The services provided by the websites maintained, operated or owned by MTPL do not extend to acting as an
        agent (express or implied) on behalf of any subscriber or user.
      </p>
      <p>MTPL has no agents and does not operate through any agents save for those specifically mentioned on the home page of the website.</p>
      <p>
        The Terms and conditions mentioned above regulate the usage of MyAmbii.com. Any person using MyAmbii.com in
        violation of the stipulations contained in the Terms and Conditions of MyAmbii.com shall render
        himself/herself liable to appropriate action in a court of law both civil and criminal.
      </p>
      <p>
        <strong>
          BY ACCEPTING THESE TERMS AND CONDITIONS, YOU AGREE TO INDEMNIFY AND OTHERWISE HOLD HARMLESS MTPL, ITS
          DIRECTORS, OFFICERS, EMPLOYERS, AGENTS, SUBSIDIARIES, AFFILIATES AND OTHER PARTNERS FROM ANY DIRECT,
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR EXEMPLARY DAMAGES ARISING OUT OF, RELATING TO, OR
          RESULTING FROM YOUR USE OF THE SERVICES OBTAINED THROUGH MYAMBII.COM INCLUDING BUT NOT LIMITED TO
          INFORMATION PROVIDED BY YOU OR ANY OTHER MATTER RELATING TO MYAMBII.COM. ANY REFERENCE TO DUTIES AND TAXES
          ETC IN THESE TERMS OF USE SHALL INCLUDE GOODS AND SERVICES TAX (HEREIN REFERRED AS GST) FROM THE DATE GST
          LAW IS IMPLEMENTED IN INDIA. ANY ADDITIONAL TAX LIABILITY ARISING ON ACCOUNT OF INTRODUCTION OF GST
          (WHETHER ON ACCOUNT OF INCREASE IN RATE OR ANY CHANGE BROUGHT IN BY THE NEW TAX REGIME) WOULD BE RECOVERED
          OVER AND ABOVE THE AGREED CONTRACT PRICE / SERVICE FEE.
        </strong>
      </p>
      <p>
        If any dispute arises between a user/users and MTPL arising out of use of MyAmbii.com or thereafter, in
        connection with the validity, interpretation, implementation or alleged breach of any provision of these
        Terms and Conditions, the dispute shall be referred to a sole arbitrator who shall be appointed in
        accordance with prevailing law. Decision of the arbitrator shall be final and binding on both the parties
        to the dispute. The place of arbitration shall be Navi Mumbai, India. The Arbitration &amp; Conciliation
        Act, 1996 as amended, shall govern the arbitration proceedings.
      </p>
      <p>
        These Terms and Conditions shall be governed by and construed in accordance with the laws of the Republic
        of India, without regard to its conflict of law provisions. Subject to the arbitration provision above, the
        courts at Navi Mumbai, India shall have exclusive jurisdiction, including in respect of any application for
        interim relief and any proceedings for the supervision or enforcement of the arbitration.
      </p>
      <p>
        The user of MyAmbii.com is subject to the <strong>Privacy Policy</strong> available through{' '}
        <Link href="/privacy">this link</Link>.
      </p>
      <p>
        In case of non-compliance of these Terms and Conditions or Privacy Policy MTPL may terminate usage rights
        and take down any offending information that might have been upoloaded by such subscriber/user
      </p>

      <h2>1. MyAmbii Resume Posting / Submission of Resume / Resume Upload / Resume Manager</h2>
      <p>By registering your resume on MyAmbii.com, you agree to the following terms:</p>
      <ol>
        <li>The resume/ insertion or information/data fed by the user can be updated by the user alone, free of cost.</li>
        <li>MTPL offers no guarantee nor warranties that there would be a satisfactory response or any response at all once the resume/ insertion or information/data is fed by the user.</li>
        <li>
          MTPL neither guarantees nor offers any warranty about the credentials bonafides, status or otherwise of
          the prospective employer/organization which downloads the resume/ insertion or information/data and uses
          it to contact the user.
        </li>
        <li>
          MTPL would not be held liable for loss of any data technical or otherwise, or of the resume/ insertion or
          information/data or particulars supplied by user due to acts of god as well as reasons beyond its control
          like corruption of data or delay or failure to perform as a result of any cause(s) or conditions that are
          beyond MTPL &apos;s reasonable control including but not limited to strikes, riots, civil unrest, Govt.
          policies, tampering of data by unauthorized persons like hackers, distributed denial of service attacks,
          virus attacks, war and natural calamities.
        </li>
        <li>
          It shall be sole prerogative and responsibility of the user to check the authenticity of all or any
          response received pursuant to the resume/ insertion or information/data being fed into the network system
          of MTPL by the user, for going out of station or in station for any job or interview. MTPL assumes no
          responsibility in respect thereof and expressly disclaims any liability for any act, deed or thing which
          the user may so do, pursuant to the receipt of the response, if any, to the resume/ insertion or
          information/ date being fed into the network system of MTPL .
        </li>
        <li>
          Uploading of multiple resumes beyond a reasonable limit by the same individual, using the same or
          different accounts shall entitle MTPL to remove the Resumes without notice to the subscriber. 6.a This
          service is only meant for candidates looking for suitable jobs. Any usage with commercial intent is
          prohibited.
        </li>
        <li>MTPL reserves its right to reject and delete any resume/ insertion or information/data fed in by the user without assigning any reason.</li>
        <li>
          This free service entitles the user alone i.e the same person, to add modify or change the
          data/information fed in by him but does not entitle him to use the free service to feed fresh insertion
          or information/data /resume of another person in place of the insertion or information/data already fed
          in by such user.
        </li>
        <li>MTPL has the right to make all such modifications/editing of resume in order to fit resume in its database.</li>
        <li>
          The subscriber shall be assigned a password (s) by MTPL to enable the subscriber to access all the
          information received through MyAmbii.com, but the sole responsibility of the safe custody of the password
          shall be that of the subscriber and MTPL shall not be responsible for data loss/theft of data/corruption
          of data or the wrong usage/misuse of the password and any damage or leak of information and its
          consequential usage by a third party. MTPL undertakes to take all reasonable precautions at its end to
          ensure that there is no leakage/misuse of the password granted to the subscriber. When you indicate your
          interest in a Job Listing on MyAmbii.com, you are sending your CV and application information including
          relevant documents to MyAmbii.com, and you are requesting and authorizing MyAmbii.com to make available
          such application information to the applicable Employer(s) for such Job Listing(s).
        </li>
        <li>
          In addition, by using MyAmbii.com, you agree that MyAmbii.com is not responsible for the content of the
          Employer&apos;s application form, messages, screener questions, testing assessments; required documents,
          or their format or method of delivery.
        </li>
        <li>
          You consent to your application, documents and any responses sent to you by the Employer or vice versa
          through MyAmbii.com being processed and analysed by MyAmbii.com according to these terms of use and
          MyAmbii.com&apos;s Privacy Policy. MyAmbii.com shall store and process such information regardless of
          whether a job vacancy has been filled. MyAmbii.com may use your application materials (including public
          CVs and responses to employer&apos;s questions) to determine whether you may be interested in a Job
          Listing, and MyAmbii.com may reach out to you about such Job Listing.
        </li>
        <li>
          Information you post in public areas of MyAmbii sites or applications or make visible in the resume and
          profile database may be accessed, used, and stored by others around the world, including those in
          countries that might not have legislation that guarantees adequate protection of personal information as
          defined by your country of residence. While MyAmbii.com takes measures to safeguard your information from
          unauthorized access or inappropriate use, MyAmbii.com does not control these third parties and we are not
          responsible for their use of information you give to us. Accordingly, you should not post sensitive
          information or any other information you would not want made public, to any portion of MyAmbii.com or
          application or to a public website.
        </li>
        <li>
          In order to use MyAmbii.com, you may sign in using your Facebook/Google login. If you do so, you authorize
          us to access and use certain Facebook/Google account information, including but not limited to your
          public Facebook profile and posts. For more details regarding the information we collect from you and how
          we use it, please visit our Privacy Policy.
        </li>
        <li>
          It shall be the sole responsibility of the user to ensure that it uses the privacy setting options as it
          deems fit to debar / refuse access of the data fed by it, to such corporate entities individuals or
          consultants. MTPL shall not be responsible for such insertions / data being accessed by its subscribers or
          users whose access has not been specifically blocked /debarred by the user while using the privacy
          settings.
        </li>
        <li>
          Even though you may have marked your profile as unsearchable, on viewing a MyAmbii Recruiter / Employer
          profile when you are logged into your MyAmbii.com account, a snapshot of your profile maybe made visible
          to the Recruiter / Employer.
        </li>
        <li>
          Although MTPL will make all possible efforts to adhere to these privacy settings, it will not be
          responsible for a resume being seen by a blocked user for any reason. For best privacy settings it is
          recommended that you do not allow your resume to be searched at all.
        </li>
        <li>
          The user represents that he/she is not a minor and is not under any legal or other disability which
          limits his/her ability to comply with these Terms or to install and use the services subscribed and
          purchased with minimal risk of harm to you or others. You further represent that you are not purchasing
          the products/services for resale to others and will not do so without MTPL (India) Limited&apos;s prior
          written consent.
        </li>
        <li>All changes / modifications made by the user to the data / information shall be effected and will come into operation only after 24-48 hours of such changes / modifications being made.</li>
        <li>
          The user agreement between a user/subscriber and MTPL will be treated as having been terminated in the
          following events: ( i ) On completion of the term for which the user/subscriber engages the services of
          the website; or ( ii ) In case the user/subscriber violates any of the conditions of this agreement or any
          other agreement entered into by him with MTPL, however, such termination will be at the option and
          discretion of MTPL; or ( iii )On writing and on such terms as agreed to by the parties mutually.
        </li>
        <li>The User of these services does not claim any copyright or other Intellectual Property Right over the data uploaded by him/her on the website.</li>
      </ol>

      <h2>2. Resume Display</h2>
      <ol>
        <li>The payment for service once subscribed to by the subscriber is not refundable and any amount paid shall stand appropriated.</li>
        <li>
          The amount paid entitles the subscriber alone to the service by MTPL for a period of subscription opted
          for from the date of up-linking of the resume on the website MyAmbii.com or such other mirror or parallel
          site(s) as MTPL may deem fit and proper but such web host shall be without any extra cost to the
          subscriber / user.
        </li>
        <li>The resume displayed can be updated by the subscriber alone free of cost.</li>
        <li>Notwithstanding anything contained herein, through Resume Display service your resume is made available from the home page of MyAmbii.com and can be by freely accessed by anyone.</li>
        <li>
          Additionally, through this service your resume is also made a part of MyAmbii.com&apos;s proprietary
          database, accessed only by companies/Recruiter / Employer registered with us. Please log into your
          account and set the visibility of the resume as desired by you, here you can selectively block a
          company/Recruiter / Employer from accessing your resume. (Please note that the confidentiality settings of
          the resume which has been made part of the exclusive database is independent of the confidentiality
          settings of the resume made part of the free search service)
        </li>
        <li>MTPL offers neither guarantee nor warranties that there would be a satisfactory response or any response at all once the resume Is put on display.</li>
        <li>
          MTPL neither guarantees nor offers any warranty about the credentials of the prospective
          employer/organization which down loads the information and uses it to contact the prospective employee /
          visitor / user / subscriber.
        </li>
        <li>
          MTPL would not be held liable for loss of any data technical or otherwise, and particulars supplied by
          subscribers due to reasons beyond its control like corruption of data or delay or failure to perform as a
          result of any causes or conditions that are beyond MTPL &apos;s reasonable control including but not
          limited to strikes, riots, civil unrest, Govt. policies, tampering of data by unauthorized persons like
          hackers, war and natural calamities.
        </li>
        <li>
          It shall be the sole prerogative and responsibility of the individual to check the authenticity of all or
          any response received pursuant to the resume being displayed by MTPL for going out of station or in
          station for any job / interview and MTPL assumes no responsibility in respect thereof.
        </li>
        <li>
          MTPL reserves its right to reject any insertion or information/data provided by the subscriber without
          assigning any reason either before uploading or after uploading the vacancy details, refund if any shall
          be on a pro-rata basis at the sole discretion of MTPL .
        </li>
        <li>MTPL will commence providing services only upon receipt of amount/charges upfront either from subscriber or from a third party on behalf of the subscriber.</li>
        <li>This subscription is not transferable i.e. it is for the same person throughout the period of subscription.</li>
        <li>MTPL has the right to make all such modifications/editing of resume in order to fit the resume in its database.</li>
        <li>The liability, if any, of MTPL is limited to the extent of the amount paid by the subscriber.</li>
        <li>
          The subscriber shall be assigned password(s) by MTPL to enable the subscriber to access all the
          information received through its site MyAmbii.com, but the sole responsibility of the safe custody of the
          password shall be that of the subscriber and MTPL shall not be responsible for data loss/theft or
          data/corruption or the wrong usage/misuse of the password and any damage or leak of information and its
          consequential usage by a third party. MTPL undertakes to take all reasonable precautions at its end to
          ensure that there is no leakage/misuse of the password granted to the subscriber
        </li>
        <li>The subscriber undertakes that the data/information provided by him is true and correct in all respects.</li>
        <li>The User of these services does not claim any copyright or other Intellectual Property Right over the data uploaded by him/her on the website</li>
        <li>Service will be deemed approved if a user fail to review the profile for 7 days. Users are advised to add or remove any information on profile which are not relevant to user.</li>
      </ol>

      <h2>3. Recruiter / Employer</h2>
      <ol>
        <li>The payment for service once subscribed to by the subscriber is not refundable and any amount paid shall stand appropriated.</li>
        <li>Through Recruiter / Employer, the subscriber can buy credits to send messages to the Recruiter / Employer of his/her choice.</li>
        <li>
          If the Recruiter / Employer does not view the message sent to him/her within 15 days, the period being
          subject to change without prior notice, then the credit would be returned to the jobseeker. Credits will
          be returned only once.
        </li>
        <li>
          <strong>All the credits are valid for one year from the date of purchase. *</strong>
          <ul>
            <li><strong>* Subject to applicable terms &amp; conditions</strong></li>
          </ul>
        </li>
        <li>After contacting a Recruiter / Employer, the jobseeker cannot send a message to the same Recruiter / Employer for 30 days, the period being subject to change without prior notice.</li>
        <li>Using the service, the jobseeker would be able to send a message of maximum 500 characters along with a subject line of maximum 200 characters.</li>
        <li>MTPL offers neither guarantee nor warranties that there would be a satisfactory response or any response at all once the message is sent to the Recruiter / Employer.</li>
        <li>
          MTPL neither guarantees nor offers any warranty about the credentials of the prospective Recruiter /
          Employer/organization which sees the message and down loads the information and uses it to contact the
          prospective employee / visitor / user / subscriber.
        </li>
        <li>
          It shall be the sole prerogative and responsibility of the individual to check the authenticity of all or
          any response received pursuant to the connect message for going out of station or in station for any job
          / interview and MTPL assumes no responsibility in respect thereof.
        </li>
        <li>This subscription is not transferable i.e. it is for the same person throughout the period of subscription.</li>
        <li>The subscriber undertakes that the data/information provided by him is true and correct in all respects.</li>
        <li>This service shall not be utilized by the user for uploading/transmitting content which is illegal or objectionable in any manner.</li>
        <li>The User of these services does not claim any copyright or other Intellectual Property Right over the data uploaded by him/her on the website.</li>
      </ol>

      <h2>7. Applications by Non Registered Users</h2>
      <ol>
        <li>The user undertakes that the data/information being provided by him/her in the resume is true and correct in all respects..</li>
        <li>
          MTPL does not share personally identifiable data of any individual with other companies/entities without
          obtaining permission. MTPL may share all such information that it has in its possession for its own
          purposes including sending promotional mailers etc and in response to legal process, such as a court
          order or subpoena.
        </li>
        <li>The user undertakes that he/she will not disseminate false/objectionable/offensive material using these services.</li>
        <li>This interface shall be exclusively for the purposes of bona fide job applications; usage of the interface in any other fashion is strictly prohibited.</li>
        <li>
          MTPL neither guarantees nor offers any warranty about the credentials bonafides, status or otherwise of
          the prospective employer/organization which downloads the resume/ insertion or information/data and uses
          it to contact the user.
        </li>
        <li>The user shall not infringe on any intellectual property rights of any person/entity or retain information/download any information from any computer system or otherwise with an intention to do so.</li>
        <li>
          The User/subscriber/visitor to MyAmbii.com or affiliated site(s) is prohibited from introducing/posting or
          transmitting information or software, which contains a computer virus, or a contaminant, worm or other
          harmful components on the internet or on MyAmbii.com site or sub-domains or on any affiliate sites or any
          other network system
        </li>
        <li>
          MTPL will not be party to any legal proceedings between a user (e.g. a subscriber) and a party contracted
          through the site. In case MTPL is implicated in any legal proceedings, costs will be recovered from the
          party that names MTPLMTPL however will abide with any court order served on it through due process.
        </li>
        <li>
          When you indicate your interest in a Job Listing on MyAmbii.com, you are sending your CV and application
          information including relevant documents to MyAmbii.com, and you are requesting and authorizing
          MyAmbii.com to make available such application information to the applicable Employer(s) for such Job
          Listing(s).
        </li>
        <li>
          In addition, by using MyAmbii.com, you agree that MyAmbii.com is not responsible for the content of the
          Employer&apos;s application form, messages, screener questions, testing assessments; required documents,
          or their format or method of delivery.
        </li>
        <li>
          You consent to your application, documents and any responses sent to you by the Employer or vice versa
          through MyAmbii.com being processed and analysed by MyAmbii.com according to these terms of use and
          MyAmbii.com&apos;s Privacy Policy. MyAmbii.com shall store and process such information regardless of
          whether a job vacancy has been filled. MyAmbii.com may use your application materials (including public
          CVs and responses to employer&apos;s questions) to determine whether you may be interested in a Job
          Listing, and MyAmbii.com may reach out to you about such Job Listing.
        </li>
        <li>
          Information you post in public areas of MyAmbii sites or applications or make visible in the resume and
          profile database may be accessed, used, and stored by others around the world, including those in
          countries that might not have legislation that guarantees adequate protection of personal information as
          defined by your country of residence. While MyAmbii.com takes measures to safeguard your information from
          unauthorized access or inappropriate use, MyAmbii.com does not control these third parties and we are not
          responsible for their use of information you give to us. Accordingly, you should not post sensitive
          information or any other information you would not want made public, to any portion of MyAmbii.com or
          application or to a public website.
        </li>
      </ol>
      <p>
        As a jobseeker, you expressly acknowledge that communications sent to or received from employers via the
        Platform may be reviewed or routed through MyAmbii-controlled systems for the limited purposes stated
        above. In some instances, your contact information (such as phone number or email address) may be masked or
        anonymized to protect you from misuse or unauthorized access. You may receive calls or messages from
        employers through masked identifiers, and you may not be able to respond directly unless the employer
        chooses to disclose their actual contact details.
      </p>
      <p>
        You understand and agree that such mechanisms are intended to safeguard your interests, prevent
        exploitation or fraud, and maintain the integrity of the recruitment process facilitated through the
        Platform. However, this does not imply that MyAmbii undertakes to actively monitor or take action against
        every instance of potential misuse. Jobseekers are encouraged to proactively report any concerns or
        violations by using the &quot;Report&quot; feature available on the Platform or by raising a formal
        grievance through the designated grievance redressal mechanism provided on the website.
      </p>

      <h2>Recruiter / Employer</h2>
      <p>Additional Terms applicable to Recruiter / Employers &quot;You&quot; accessing any portion of the website MyAmbii.com:</p>
      <ol>
        <li>
          You will comply with all applicable data protection laws in relation to the processing of personal data;
          and not process personal data in an unlawful manner and excessive with regard to agreed purposes as
          defined in the privacy policy and this terms and conditions
        </li>
        <li>
          You shall implement adequate technical and organizational controls to protect the shared personal data
          obtained from the Company against unauthorised or unlawful processing and against accidental loss,
          destruction, damage, alteration or disclosure
        </li>
        <li>
          The onus of any misuse of personal details accessed through your account lies on You. Access to services
          subscribed by You may be availed of and extended to authorized personnel only i.e. persons who are bound
          by employment agreements and confidentiality agreements
        </li>
        <li>You agree to provide reasonable assistance as is necessary to facilitate the handling of any Data Security Breach (as relevant under privacy laws applicable) in an expeditious and compliant manner</li>
        <li>You agree that the responsibility for complying with a data subject /data principal request lies with the Party which holds/processes the Personal Data collected/shared</li>
        <li>You warrant and represent that the institution shall not disclose or transfer Personal Data obtained from the Company to any sub-processors without ensuring that adequate and equivalent safeguards to the Personal Data.</li>
        <li>You shall retain or process shared Personal Data for no longer than is necessary to carry out the agreed purposes.</li>
        <li>You shall act as an independent Data Controller in respect of shared personal data obtained from the Company once the data is collected by You and You shall be responsible for its secure use at all times.</li>
        <li>To prevent any unauthorized users from accessing your account, you should maintain control over the account/devices that are used to access MyAmbii and not reveal the password or other confidential details associated with the account to anyone.</li>
        <li>When you use a device to access the Platform, MTPL may collect device location and other technical details to ensure safe access to account.</li>
        <li>In case any suspicious activity is noted in your account, MTPL may place restrictions on your account, which may extend to disabling access.</li>
        <li>In case you initiate a contact with a specific jobseeker, your contact details may be shared with the jobseeker.</li>
      </ol>

      <h2>8. Display of Banners</h2>
      <ol>
        <li>MTPL agrees to provide the service to the subscriber only for the duration or the number of impressions contracted for, to the best of its ability.</li>
        <li>MTPL will display the banners on all the relevant/specified sections of the site on a rotation basis</li>
        <li>
          MTPL reserves its right to reject any insertion or information/data provided by the subscriber without
          assigning any reason, but in such an eventuality, any amount so paid for, may be refunded to the
          subscriber on a pro-rata basis at the sole discretion of MTPL
        </li>
        <li>MTPL offers no guarantee nor warranties that there would be a satisfactory response or any response at all once the banners are put on display</li>
        <li>
          MTPL would not be held liable for any loss of data technical or otherwise, information, particulars
          supplied by the customers due to the reasons beyond its control like corruption of data or delay or
          failure to perform as a result of any causes or conditions that are beyond MTPL &apos;s reasonable
          control including but not limited to strike, riots, civil unrest, Govt. policies, tampering of data by
          unauthorized persons like hackers, war and natural calamities
        </li>
        <li>MTPL will commence providing services only upon receipt of amount/charges upfront either from the subscriber or from a third party on behalf of the subscriber</li>
        <li>This subscription is neither re-saleable nor transferable by the subscriber to any other person, corporate body, firm or individual</li>
        <li>The subscriber/Recruiter / Employer/Advertiser must give an undertaking to MTPL that there will be no fee charged from any person who responds to jobs advertised on MyAmbii.com for processing of applications / responses from such person</li>
        <li>
          The User of these services does not claim any copyright, Trade Mark or other Intellectual Property Right
          over the data uploaded by him/her on the website. The Banners displayed on MyAmbii shall be prepared as
          per the instructions received from the users, MTPL shall not be responsible for the users misappropriation
          of the Trade Mark/ Copyright or any other Intellectual Property Right sought to be passed of as that of
          the user.
        </li>
      </ol>

      <h2>12. MyAmbii Recruiter / Employer</h2>
      <ol>
        <li>
          The MyAmbiiRecruiter / Employer profile may be updated/edited etc. by the user alone. The user shall not
          upload, post, transmit, publish, or distribute any material or information that is unlawful, or which may
          potentially be perceived as being harmful, threatening, abusive, harassing, defamatory, libellous,
          vulgar, obscene, or racially, ethnically, or otherwise objectionable.
        </li>
        <li>Uploading of multiple profiles by the same Recruiter / Employer using the same or different accounts shall entitle MTPL to remove the profiles without notice to the subscriber.</li>
        <li>MTPL reserves its right to reject and delete any profile or information/data fed in by the user without assigning any reason.</li>
        <li>
          The sole responsibility of the safe custody of the log in details shall be that of the user and MTPL
          shall not be responsible for data loss/theft of data/corruption of data or the wrong usage/misuse of the
          password and any damage or leak of information and its consequential usage by a third party. MTPL
          undertakes to take all reasonable precautions at its end to ensure that there is no leakage/misuse of the
          password created by the user/Recruiter / Employer.
        </li>
        <li>MTPL shall in no way be held liable for any information received by the user and it shall be the sole responsibility of the user to check, authenticate and verify the information/response received at its own cost and expense.</li>
        <li>The user represents that he/she is not a minor and is not under any legal or other disability which limits his/her ability to comply with these Terms or to install and use the services subscribed and purchased with minimal risk of harm to you or others.</li>
        <li>All changes / modifications made by the user to the data / information shall be effected and will come into operation only after 24-48 hours of such changes / modifications being made.</li>
        <li>
          On registration you agree:
          <ol type="a">
            <li>to make your profile available for display in the public domain.</li>
            <li>that you have the requisite authority to upload the job listings that are posted through the profile created by you in this section of MyAmbii.com i.e. MyAmbii Recruiter / Employer.</li>
            <li>
              and understand that MTPL may place the information relating to vacancies posted by me through my
              MyAmbii Recruiter / Employer account in the any of Classified sections on the website MyAmbii.com or
              such other mirror or parallel site(s) or in allied publications as MTPL may deem fit and proper.
            </li>
          </ol>
        </li>
      </ol>

      <p>
        <strong>BY COMPLETING ENROLMENT AND PAYMENT, YOU CONFIRM THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO THESE TERMS AND CONDITIONS.</strong>
      </p>
      <p>
        You acknowledge and agree that certain communications transmitted, exchanged, or facilitated through
        systems controlled or operated by MyAmbii, including, without limitation, messages, emails, chats, and
        telephonic interactions may be subject to limited review, routing, or filtering by MyAmbii solely for the
        purpose of identifying, investigating, and acting upon any actual or suspected misuse of the Platform,
        including misuse of jobseeker data, and for detecting and preventing fraudulent, unlawful, or abusive
        conduct.
      </p>
      <p>
        Such activities are undertaken by MyAmbii in its capacity as an intermediary under the Information
        Technology Act, 2000 and the rules framed thereunder, particularly the Information Technology (Intermediary
        Guidelines and Digital Media Ethics Code) Rules, 2021, for the purpose of exercising due diligence and
        discharging its obligations thereunder.
      </p>
      <p>Accordingly, MyAmbii may, without prior notice:</p>
      <ol>
        <li>Present contact information such as phone numbers or email addresses in a manner that enhances user privacy and mitigates risks of misuse or unauthorized access.</li>
        <li>Withhold, block, or decline to transmit any communication that it reasonably believes to be malicious, harmful, violative of these Terms, or inconsistent with applicable law.</li>
        <li>Use automated tools or filters to detect and flag messages that may be harmful or violate the law, within the limits allowed by law.</li>
      </ol>
      <p>
        This clause is without prejudice to MyAmbii&apos;s rights as an intermediary and shall not be construed as
        an obligation to monitor all communications or assume liability for any third-party content. MyAmbii does
        not initiate transmission, select the receiver of the transmission, or modify the information contained in
        such transmission, except as may be necessary to comply with applicable law or to exercise due diligence in
        good faith.
      </p>
      <p>
        By using the Platform, you expressly consent to such limited review and routing of communications solely
        for the purposes mentioned above, and you agree that such measures shall not amount to breach of
        confidentiality, interception, or unlawful surveillance under any applicable law.
      </p>
      <p>
        <strong>Note:</strong> The terms in this agreement may be changed by MTPL at any time. MTPL is free to
        offer its services to any client/prospective client without restriction.
      </p>
    </LegalDocument>
  );
}
