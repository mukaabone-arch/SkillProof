import type { Metadata } from 'next';
import LegalDocument from '@/components/landing/LegalDocument';

export const metadata: Metadata = { title: 'Privacy Policy · MyAmbii' };

/**
 * Real Privacy Policy content, replacing the LegalStub placeholder — see
 * LegalDocument.tsx for the shared header/column chrome. Transcribed from
 * privacy-policy-content.md (14 numbered sections + a Cookie Policy with its
 * own lettered subsections and a cookie-category table), rendered as written:
 * no clause is reworded, condensed, or corrected, including ones that read
 * awkwardly in the source (grammar as-authored, e.g. "when the you sign up"
 * in §2, "contact details mentions" in §9). Section numbering is the
 * author's own and is not renumbered.
 *
 * The one added piece of structure beyond a literal transcription: §4's
 * prose reference to "our Cookie Policy set out at the end of this page" is
 * wired to #cookie-policy (the heading below carries that id) — a same-page
 * anchor link, not a content change, since the words are identical to the
 * source and the destination genuinely is later on this same page.
 */
export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" lastUpdated="15 August 2026">
      <h2>1. Introduction</h2>
      <p>
        We, at Mukaab Technologies Private Ltd. (hereinafter collectively referred to as &quot;MTPL&quot;), are
        committed to respecting your online privacy and recognize the need for appropriate protection and
        management of any personally identifiable information you share with us. This Privacy Policy
        (&quot;<strong>Policy</strong>&quot;) describes how MTPL collects, uses, discloses and transfers personal
        information of users through its websites and applications, including through www.MyAmbii.com, mobile
        applications and online services (collectively, the &quot;Platform&quot;). This policy applies to those who
        visit the Platform, or whose information MTPL otherwise receives in connection with its services (such as
        contact information of individuals associated with MTPL including partners) (hereinafter collectively
        referred to as &quot;Users&quot;). For the purposes of the Privacy Policy, &quot;<strong>You</strong>&quot;
        or &quot;<strong>Your</strong>&quot; shall mean the person who is accessing the Platform.
      </p>

      <h2>2. Types of Personal Information collected by MTPL</h2>
      <p>
        &quot;Personal information&quot; (PI) - means any information relating to an identified or identifiable
        natural person including common identifiers such as a name, an identification number, location data, an
        online identifier or one or more factors specific to the physical, physiological, genetic, mental,
        economic, cultural or social identity of that natural person and any other information that is so
        categorized by applicable laws. We collect information about you and/or your usage to provide better
        services and offerings. The Personal Information that we collect, and how we collect it, depends upon how
        you interact with us. We collect the following categories of Personal Information in the following ways:
      </p>
      <ul>
        <li>
          name, email address, password, country, city, contact number and company/organization that you are
          associated with, when the you sign up for alerts on the Platform;
        </li>
        <li>
          information that one would usually include in a resume, including name, contact details including
          e-mail address and mobile number, work experience, educational qualifications, data relating to your
          current and past remuneration or salary, a copy of your resume, etc. when you register on the Platform;
        </li>
        <li>
          information about the services that you use and how you use them, including log information and
          location information, when you are a user of the services through the Platform;
        </li>
        <li>
          we may collect your Personal Information such as name, age, contact details, preferences, etc. through
          surveys and forms, when you choose to participate in these surveys etc.;
        </li>
        <li>
          we may also collect information relating to your caste and information about whether you are eligible
          for any affirmative action programmes or policies, if you opt to provide such information;
        </li>
        <li>
          when you communicate with MTPL or use the Platform to communicate with other Users (such as partners),
          we collect information about your communication and any information you choose to provide;
        </li>
        <li>
          when you visit the Platform, we use cookies to automatically collect, store and use technical
          information about your system and interaction with our Platform and the services used after accessing
          the Platform;
        </li>
        <li>
          If you choose to access services offered by any of our affiliates we will share your data with the
          affiliate in accordance with this policy. When you access the webpage/link or services of our affiliates
          through the Platform, you will also be governed by the terms and privacy policy of such affiliates. You
          are advised to read the terms and privacy policy of the affiliates to understand the manner in which the
          affiliates handle and process your personal data, including sharing your data with MTPL.
        </li>
        <li>
          when you use a device to access the Platform, MTPL may collect technical or other related information
          from the device as well as the device location;
        </li>
        <li>
          To the extent permitted by law, MTPL may record and monitor your communications with us to ensure
          compliance with our legal and regulatory obligations and our internal policies. This may include the
          recording of telephone conversations;
        </li>
        <li>
          If you choose to sign in with your social media account to access the Platform, or otherwise connect
          your social media account with the services of the Platform, you consent to our collection, storage, and
          use, in accordance with this Privacy Policy, of the information that you make available to us through
          the social media interface. Please see your social media provider&apos;s privacy policy and help centre
          for more information about how they share information when you choose to connect your account.
        </li>
      </ul>

      <h2>3. How MTPL may use your Personal Information</h2>
      <p>We will only use your personal data in a fair and reasonable manner, and where we have a lawful reason to do so.</p>
      <p>
        Our use of your personal data depends on the purpose for which you interact with us. We may process your
        Personal Information for the following purposes:
      </p>
      <ul>
        <li>
          Providing our services and products to you including to send you job alerts, calendar alerts, relevant
          search results, recommended jobs and/or candidates (as the case maybe), and other social media
          communication facilities;
        </li>
        <li>Protecting our Users and providing you with customer support;</li>
        <li>
          We use information collected from cookies and other technologies, to improve your user experience and
          the overall quality of our services (for more information please refer to paragraph 4 below). When
          showing you tailored ads, we will not associate an identifier from cookies or similar technologies with
          sensitive categories, such as those based on race, religion, sexual orientation or health.
        </li>
        <li>Improving the Platform and its content to provide better features and services.</li>
        <li>Conducting market research and surveys with the aim of improving our products and services.</li>
        <li>
          Sending you information about our products and services (including those of our affiliates) for
          marketing purposes and promotions;
        </li>
        <li>
          Preventing, detecting, investigating and taking action against crimes (including but not limited to
          fraud and other financial crimes), any other illegal activities, suspected fraud, or violations of
          MTPL&apos;s Terms of Use in any jurisdiction
        </li>
        <li>To the extent required for identity verification, government sanctions screening and due diligence checks.</li>
        <li>
          Establishing, exercising or defending legal rights in connection with legal proceedings (including any
          prospective legal proceedings) and seeking professional or legal advice in relation to such legal
          proceedings.
        </li>
      </ul>

      <h2>4. Cookies and Other Tracking Technologies</h2>
      <p>
        Some of our web pages utilize &quot;cookies&quot; and other tracking technologies. A &quot;cookie&quot; is
        a small text file that may be used, for example, to collect information about web-site activity. Some
        cookies and other technologies may serve to recall Personal Information previously indicated by a user.
        Most browsers allow you to control cookies, including whether or not to accept them and how to remove
        them.
      </p>
      <p>
        You may set most browsers to notify you if you receive a cookie, or you may choose to block cookies with
        your browser, but please note that if you choose to erase or block your cookies, you will need to re-enter
        your original user ID and password to gain access to certain parts of the Platform.
      </p>
      <p>
        Tracking technologies may record information such as Internet domain and host names; Internet protocol
        (IP) addresses; browser software and operating system types; clickstream patterns; and dates and times
        that our site is accessed. Our use of cookies and other tracking technologies allows us to improve our
        Platform and the overall website experience. We may also analyse information that does not contain
        Personal Information for trends and statistics.
      </p>
      <p>
        For more information about our use of cookies please refer to our <a href="#cookie-policy">Cookie Policy</a> set
        out at the end of this page.
      </p>

      <h2>5. The Basis/ Grounds which we rely on for collection and processing of your Personal Information:</h2>
      <p>
        Your Personal Information is collected and processed by MTPL based on the following legal grounds
        depending upon the nature of Personal Information and the purposes for which it is processed.
      </p>
      <ul>
        <li>
          <strong>Consent:</strong> MTPL relies on your consent in order to process your Personal Information in
          certain situations. If MTPL requires your consent to collect and process certain Personal Information,
          as per the requirements under the applicable data protection laws, your consent is sought at the time of
          collection of your Personal Information and such processing will only be performed where consent is
          secured.
        </li>
        <li>
          <strong>Compliance with a legal obligation:</strong> Your Personal Information may be processed by MTPL,
          to the extent that such processing is necessary to allow MTPL to comply with a legal obligation. An
          example of this would be if MTPL is required to disclose your Personal Information to respond to a court
          order or if MTPL is required to retain specific records for a fixed period to comply with requirements
          under any applicable law.
        </li>
      </ul>

      <h2>6. Information Sharing and Disclosure</h2>
      <p>
        We restrict access to your Personal Information to employees who we believe reasonably need to know/or
        that information to fulfil their jobs to provide, operate, develop, or improve our products or services.
      </p>
      <p>MTPL does not disclose, transfer or share your Personal Information with others except with:</p>
      <ul>
        <li>
          Our affiliates and group companies to the extent required for our internal business and/or
          administrative purposes and/or general corporate operations and for provision of services aimed at
          helping you in your career enhancement;
        </li>
        <li>
          Potential recruiters if we determine that your resume matches a particular job description/ vacancy
          available with such recruiters. By registering on the Platform and consenting to the terms of this
          Privacy Policy, you agree that MTPL may contact you or forward your resume to potential recruiters;
        </li>
        <li>If in case you initiate a contact with a specific jobseeker, your contact details may be shared with the jobseeker.</li>
        <li>
          Educational institutions, University or Affiliating University / University which will award your
          degree, government educational department, training institutes or educational service providers,
          contest organizers or career session partners for the purpose of career development
        </li>
        <li>
          Third parties including enforcement, regulatory and judicial authorities, if we determine that
          disclosure of your Personal Information is required to a) respond to subpoenas, court orders, or legal
          process, or to establish or exercise our legal rights or defend against legal claims; or b) investigate,
          prevent, or take action regarding illegal activities, suspected fraud, situations involving potential
          threats to the physical safety of any person, violations of MTPL&apos;s Terms of Use or as otherwise
          required by law;
        </li>
        <li>
          In the event of a merger, acquisition, financing, or sale of assets or any other situation involving the
          transfer of some or all of MTPL&apos;s business assets we may disclose Personal Information to those
          involved in the negotiation or transfer.
        </li>
        <li>
          Third party service providers and marketing partners that MTPL engages to a) provide services over the
          Platform on MTPL&apos;s behalf; b) maintain the Platform and mailing lists; or c) communicate with you on
          MTPL&apos;s behalf about offers relating to its products and/or services. MTPL will take reasonable steps
          to ensure that these third-party service providers are obligated to protect your Personal Information
          and are also subject to appropriate confidentiality / non-disclosure obligations.
        </li>
        <li>
          Third party advertisers to display advertisements to you when you visit the Platform. The third-party
          advertisers include financial service providers (such as banks, insurance agents, stock brokers and
          mortgage lenders) and non-financial companies (such as stores, airlines, and software companies). These
          companies may use information about you and your visits to this Platform and other web sites to provide
          advertisements on this Platform.
        </li>
      </ul>
      <p>
        The Company does not provide any Personal Information to the advertiser when you interact with or view a
        targeted advertisement. However, if you interact with or view an advertisement, the advertiser may make
        certain assumptions and, in the process, learn certain Personal Information about you. For instance, if
        you view and click an advertisement that is targeted towards women in the age group 18- 24 from a specific
        geographic area, the advertiser may assume that you meet the relevant criteria.
      </p>
      <p>
        MTPL does not intend to transfer Personal Information without your consent to third parties who are not
        bound to act on MTPL&apos;s behalf unless such transfer is legally required.
      </p>
      <p>
        If your Personal Information is transferred outside India, we take the necessary steps to protect your
        Personal Information in accordance with applicable data protection laws.
      </p>
      <p>
        MyAmbii&apos;s use and transfer to any other app of information received from Google APIs will adhere to{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes"
          rel="noopener noreferrer"
          target="_blank"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>7. Children</h2>
      <p>To use the Platform, you agree that you must be the minimum age (described in this paragraph below) or older.</p>
      <p>
        The minimum age for these purposes shall be eighteen (18), however if local laws require that you must be
        older for MTPL to be able to lawfully provide the services over the Platform to you then that older age
        shall apply as the applicable minimum age.
      </p>
      <p>
        If you are under the age of 18 or the age of majority in your jurisdiction, you must use the Platform
        under the supervision of your parent, legal guardian or responsible adult.
      </p>

      <h2>8. Retention of Personal Information</h2>
      <p>
        Your Personal Information will not be retained by MTPL any longer than it is necessary for the purposes
        for which the Personal Information is processed and/or in accordance with legal, regulatory, contractual
        or statutory obligations as applicable.
      </p>
      <p>At the expiry of such periods, your Personal Information will be deleted or archived in compliance with applicable laws</p>

      <h2>9. Controlling your personal information</h2>
      <p>
        You have the right to invoke your rights which are available to data principals or data subjects (as per
        applicable laws and regulations) in relation to your Personal Information which is being processed by
        MTPL.
      </p>
      <p>
        MTPL provides you the ability to keep your Personal Information accurate and up-to-date. If at any time
        you would like to a) rectify, update or correct your Personal Information; b) obtain confirmation on
        whether or not your Personal Information is processed by it; c) access your Personal Information or
        exercise your right to data portability; or d) exercise your right to restrict the continuing disclosure
        of your Personal Information to any third party by MTPL in certain circumstances, you are requested to
        contact us using the contact details mentions in paragraph 14 below. We will require you to provide a
        valid proof of your identity, in order to ensure that your rights are respected.
      </p>
      <p>
        For the exercise of certain rights, you may be required to approach the relevant authority / designated
        officer as per the provisions of the applicable data protection laws/ MTPL may in accordance with the
        provisions of applicable data protection laws, charge a fee for fulfilling your request, in particular in
        case of excessive or manifestly unfounded request. Further you acknowledge that the above mentioned rights
        are not absolute and are subject to limitations as per the applicable data protection laws.
      </p>
      <p>
        At any time, if you wish to delete your account on MyAmbii.com, you may do so by using the settings
        available in your account.
      </p>

      <h2>10. Confidentiality and Security</h2>
      <ul>
        <li>
          The security and confidentiality of your Personal Information is important to us and MTPL has invested
          significant resources to protect the safekeeping and confidentiality of your personal data. When using
          external service providers acting as processors, we require that they adhere to the same standards as
          MTPL does. Regardless of where your Personal Information is transferred or stored, we take all steps
          reasonably necessary to ensure that personal data is kept secure.
        </li>
        <li>
          We seek to ensure compliance with the requirements of the Information Technology Act, 2000 and Rules
          made there under to ensure the protection and preservation of your privacy. We have physical,
          electronic, and procedural safeguards that comply with the laws prevalent in India to protect your
          Personal Information, details of which are available at the following link: trust.MyAmbii.com. By
          accepting the terms of this Privacy Policy, you agree that the standards and practices being implemented
          by us, are reasonable and sufficient for the protection of your Personal Information.
        </li>
      </ul>

      <h2>11. Social media</h2>
      <p>
        MTPL operates channels, pages and accounts on some social media sites to inform, assist and engage with
        customers. MTPL monitors and records comments and posts made on these channels about itself in order to
        improve its products and services.
      </p>
      <p>Please note that you must not communicate the following information to MTPL through such social media sites:</p>
      <ul>
        <li>
          sensitive personal data including (i) special categories of personal data meaning any information
          revealing racial or ethnic origin, political opinions, religious or philosophical beliefs, or trade
          union membership, and the processing of genetic data, biometric data for the purpose of uniquely
          identifying a natural person, data concerning health or data concerning a natural person&apos;s sex life
          or sexual orientation and (ii) other sensitive personal data such as criminal convictions and offences
          and national identification number ; - Excessive, inappropriate, offensive or defamatory content. MTPL
          is not responsible for any information posted on those sites other than the information posted by its
          employees on its behalf. MTPL is only responsible for its own use of the Personal Information received
          through such sites.
        </li>
      </ul>

      <h2>12. Changes to this Privacy Policy</h2>
      <p>
        MTPL reserves the right to update, change or modify this Privacy Policy at any time. The Privacy Policy
        shall come to effect from the date of publication of such update, change or modification.
      </p>

      <h2>13. Disclaimer</h2>
      <p>
        MTPL does not store any account related information or any credit / debit card details. MTPL shall not be
        liable for any loss or damage sustained by Users as a result of any disclosure (inadvertent or otherwise)
        of any information concerning the User&apos;s account, credit cards or debit cards in the course of any
        online transactions or payments made for any products and/or services offered through the Platform.
      </p>
      <p>
        In case any Personal Information is shared by you with MTPL, which is not requested by MTPL during
        registration, (whether mandatorily or optionally), MTPL will not be liable for any information security
        breach or disclosure in relation to such information.
      </p>
      <p>
        If you have any questions regarding this Privacy Policy or the protection of your Personal Information,
        please contact MTPL&apos;s Data Protection Officer/ Grievance Officer at the following:
      </p>

      <h2>14. Data Protection Officer/ Grievance Officer</h2>
      <p>
        In case you have any complaints and/or grievances in relation to the processing of your Personal
        Information you can send your complaints via e-mail to our grievance officer:
      </p>
      <p>
        Grievance Officer
        <br />
        Mukaab Technologies Private Ltd.
        <br />
        Email: <a href="mailto:info@flairfuture.com">info@flairfuture.com</a>
      </p>

      <h2 id="cookie-policy">Cookie Policy</h2>
      <h3>Introduction</h3>
      <p>
        This Cookie Policy (&quot;Policy&quot;) explains that we believe in being open and clear about how we use
        your information. In the spirit of transparency, this Policy provides detailed information about how and
        when we use cookies on our Websites. This cookie policy applies to any MyAmbii.com product or service that
        links to this policy or incorporates it by reference.
      </p>

      <h3>a. Does MyAmbii.com uses cookies?</h3>
      <p>
        MyAmbii.com uses cookies, tags and other technologies when you use any of the MyAmbii.com websites, mobile
        sites or mobile apps, and any third party services you use through the MyAmbii.com Platform (for e.g.
        services offered through MTPL&apos;s affiliates) (collectively &quot;the services&quot;). Cookies are used
        to ensure everyone has their best possible experience. Cookies also help us keep your account safe. By
        continuing to visit or use our services, you are agreeing to the use of cookies and similar technologies
        for the purposes we describe in this policy. If you prefer not to receive cookies or web beacons, then you
        should stop using our site, or consult your browsing and third party cookie settings as described below.
      </p>

      <h3>b. What is a cookie?</h3>
      <p>
        Cookies are small pieces of text stored by a website you visit in your browser and subsequently sent by
        your web browser in every request to the website. A cookie file is stored in your web browser and allows
        the Site or a third-party to recognize you and make your next visit easier and the Site more useful to
        you. Essentially, cookies are a user&apos;s identification card for the MyAmbii.com servers. Cookies allow
        MyAmbii.com to serve you better and more efficiently, and to personalize your experience on our site. Web
        beacons, tags and scripts may be used in the Websites or in emails to help us to deliver cookies, count
        visits, understand usage and campaign effectiveness and determine whether an email has been opened and
        acted upon. We may analyse or perform analysis based on the use of these technologies and generate reports
        on an individual and aggregated basis.
      </p>
      <p>
        Cookies can be &quot;persistent&quot; or &quot;session&quot; cookies. A persistent cookie helps us
        recognize you as an existing user, so it&apos;s easier to return to MyAmbii.com or interact with our
        services without signing in again. After you sign in, a persistent cookie stays in your browser and will
        be read by MyAmbii.com when you return to one of our sites or a partner site that uses our services.
        Session cookies only last for as long as the session (usually the current visit to a website or a browser
        session).
      </p>

      <h3>c. What are cookies used for?</h3>
      <p>
        When you visit our Websites, we may place a number of cookies in your browser. These are known as First
        Party Cookies and are required to enable to hold session information as you navigate from page to page
        within the website. For example, we use cookies on our Websites to understand visitor and user
        preferences, improve their experience, and track and analyse usage, navigational and other statistical
        information. Additionally, cookies allow us to bring you advertising both on and off the MyAmbii.com site,
        and bring customized features to you. You can control the use of cookies at the individual browser level.
        If you elect not to activate the cookie or to later disable cookies, you may still visit our Websites, but
        your ability to use some features or areas of the Websites may be limited. We may use any of the following
        categories of cookies on the Websites as detailed below. Each cookie falls within one of the four
        following categories:
      </p>
      <div className="lp-legal-table-wrap">
        <table className="lp-legal-table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Essential Cookies</td>
              <td>
                Essential cookies (First Party Cookies) are sometimes called &quot;strictly necessary&quot; as
                without them we cannot provide many services that you need on the Website. For example, essential
                cookies help remember your preferences as you move around the Website. Essential cookies also keep
                you logged in into a website. Without them the login functionality would not work.
              </td>
            </tr>
            <tr>
              <td>Analytics Cookies</td>
              <td>
                These cookies track information about visits to the MyAmbii.com and partner (recruiter websites)
                websites so that we can make improvements and report our performance. For example: analyse visitor
                and user behaviour so as to provide more relevant content or suggest certain activities. They
                collect information about how visitors use the Websites, which site the user came from, the
                number of each user&apos;s visits and how long a user stays on the Websites. We might also use
                analytics cookies to test new ads, pages, or features to see how users react to them.
              </td>
            </tr>
            <tr>
              <td>Functionality or Preference Cookies</td>
              <td>
                During your visit to the Websites, cookies are used to remember information you have entered or
                choices you make (such as your username, language or your region) on the Websites. They also store
                your preferences when personalizing the Websites to optimize your use of MyAmbii.com. These
                preferences are remembered, through the use of the persistent cookies, and the next time you visit
                the Websites you will not have to set them again.
              </td>
            </tr>
            <tr>
              <td>Targeting or Advertising Cookies</td>
              <td>
                These Cookies are placed by third party advertising platforms or networks or MyAmbii.com in order
                to, deliver ads and track ad performance, enable advertising networks to deliver ads that may be
                relevant to you based upon your activities (this is sometimes called &quot;behavioural&quot;
                &quot;tracking&quot; or &quot;targeted&quot; advertising) on the Websites. They may subsequently
                use information about your visit to target you with advertising that you may be interested in, on
                MyAmbii.com websites or other websites. For example, these cookies remember which browsers have
                visited the websites.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>d. When does MyAmbii.com place cookies?</h3>
      <p>
        We use cookies on our websites, mobile sites and mobile applications. Any browser visiting these sites
        will receive cookies from us which helps us identify you more quickly when you return. Cookies help us to
        determine which pages or information you find most useful or interesting on our own websites.
      </p>
      <p>
        MyAmbii.com may also have some cookies for its own analytics i.e. analytics not part of Google Analytics.
        Such cookies help generate statistics and reports about visitors and their activities on the website or
        app.
      </p>

      <h3>e. How cookies are used for online analytics purposes?</h3>
      <p>
        We may use web analytics services on MyAmbii.com, such as those of Google Analytics. These services help
        us analyse how users use the services, including by noting the third-party website from which you arrive.
        The information collected by the technology will be disclosed to or collected directly by such service
        providers, who use the information to evaluate your use of the services. We also use Google Analytics for
        certain purposes related to online marketing, as described in the following sections.
      </p>

      <h3>f. What third-party cookies does MyAmbii.com use?</h3>
      <p>
        Please note that the third parties (advertising networks and providers of external services like web
        traffic analysis services) may also use cookies on our Services. Cookies on our sites. Also, note that the
        names of cookies, pixels and other technologies may change over time.
      </p>
      <p>
        We use trusted partners to help us service advertising, who may place cookies on your device. We also pull
        through content from social networks into our own pages, such as embedded Facebook feeds. The social
        networks, such as Facebook, Google, etc. may themselves also put cookies on your machine. If a user logs
        into Facebook, Twitter or Google+ via our website, they will leave a cookie on the users&apos; computer.
        This is the same process as if the user logs into these social networks directly.
      </p>
      <p>
        We also use Google Analytics on our Services to help us analyse how our Services are used. Google
        Analytics uses performance cookies to track customer&apos;s interactions. For example, by using cookies,
        Google can tell us which pages our users view, which are most popular, what time of day our websites are
        visited, whether visitors have been to our websites before, what website referred the visitor to our
        websites, and other similar information. All of this information is anonymized.
      </p>

      <h3>g. How to control cookies?</h3>
      <p>
        Most browsers allow you to control cookies through their settings preferences. However, if you choose to
        turn off these cookies, you will still see advertising on the internet but it may not be tailored to your
        interests. It does not mean that you won&apos;t be served any advertisements whilst you are online. Whilst
        we have mentioned most of the third parties involved in using targeting or advertising cookies in the
        preceding section , the list is not exhaustive and is subject to change. Therefore, even if you choose to
        turn off all the third-party cookies listed in section , you may still receive some tailored advertisements
        and recommendations.
      </p>
      <p>
        There are a number of ways you can manage what cookies are set on your devices. Essential cookies,
        however, cannot be disabled. If you do not allow certain cookies to be installed, the website may not be
        accessible to you and/or the performance, features, or services of the website may be compromised.
      </p>
      <p>
        You can also manage this type of cookie in the privacy settings on the web browser you are using. Please
        note that if you use your browser settings to block all cookies you may not be able to access parts of our
        or others&apos; websites. Please see below for more information.
      </p>

      <h4>Changing your Cookie Settings</h4>
      <p>
        The browser settings for changing your cookies settings are usually found in the &apos;options&apos; or
        &apos;preferences&apos; menu of your internet browser. In order to understand these settings, the
        following links may be helpful. Otherwise you should use the &apos;Help&apos; option in your internet
        browser for more details.
      </p>
      <ul>
        <li>
          <a
            href="https://support.microsoft.com/en-us/help/17442/windows-internet-explorer-delete-manage-cookies"
            rel="noopener noreferrer"
            target="_blank"
          >
            Cookie settings in Internet Explorer
          </a>
        </li>
        <li>
          <a
            href="https://support.mozilla.org/en-US/kb/enable-and-disable-cookies-website-preferences"
            rel="noopener noreferrer"
            target="_blank"
          >
            Cookie settings in Firefox
          </a>
        </li>
        <li>
          <a href="https://support.google.com/chrome/answer/95647" rel="noopener noreferrer" target="_blank">
            Cookie settings in Chrome
          </a>
        </li>
        <li>
          <a href="https://support.apple.com/en-in/guide/safari/sfri11471/mac" rel="noopener noreferrer" target="_blank">
            Cookie settings in Safari
          </a>
        </li>
      </ul>

      <h4>More information</h4>
      <p>
        To find out more about cookies, including how to see what cookies have been set and how to manage and
        delete them, visit{' '}
        <a href="https://www.allaboutcookies.org/" rel="noopener noreferrer" target="_blank">
          www.allaboutcookies.org
        </a>
        .
      </p>
    </LegalDocument>
  );
}
