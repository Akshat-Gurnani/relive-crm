import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy | Relive Solutions", description: "How Relive Solutions Pvt. Ltd. handles enquiry data." };

const EMAIL = "reliveakshatg@gmail.com";

export default function Privacy() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 80px", lineHeight: 1.65, fontSize: 15.5, color: "#e6e9f0" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Relive Solutions Pvt. Ltd., Lucknow, India. Last updated 22 October 2026.</p>

      <p>Relive Solutions Pvt. Ltd. (&quot;Relive&quot;, &quot;we&quot;) is a real estate advisory firm. This policy explains what we do with the details people give us when they enquire about a property, including through Facebook and Instagram lead forms, Google forms, our websites, WhatsApp and phone calls. It also covers the internal system we use to manage those enquiries (&quot;Relive CRM&quot;).</p>

      <h2>What we collect</h2>
      <ul>
        <li>Details you submit in an enquiry form: name, phone number, email address, city, and answers to the questions on the form (for example budget, property type, location or timing).</li>
        <li>Details from the advertisement that brought you to us: the form, ad, campaign and Page it came from.</li>
        <li>Notes our team writes about our conversations with you, call records, site visit dates and the status of your enquiry.</li>
      </ul>
      <p>We do not ask for payment card details, passwords or government ID numbers through enquiry forms.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To contact you about the property or project you asked about, by phone, WhatsApp, SMS or email.</li>
        <li>To arrange site visits and follow up on your enquiry.</li>
        <li>To understand which advertisements and projects lead to genuine enquiries, using counts and percentages across all enquiries. Where an AI model is used for this analysis, it receives only aggregated figures and never names, phone numbers, email addresses or notes.</li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>Who can see it</h2>
      <p>Only Relive staff who need it to handle your enquiry. We use trusted service providers to run the system (cloud hosting and database services, and email or messaging services). They process data on our instructions and are not allowed to use it for their own purposes. We may share your details with the developer or builder of the project you enquired about, so that they can assist with your purchase. We may also disclose information where the law requires it.</p>

      <h2>Where it is stored and for how long</h2>
      <p>Enquiry data is stored in a secured cloud database hosted in India. Access is limited by role and protected by sign-in. We keep an enquiry for as long as it is active and for a reasonable period afterwards for our business records, then delete or anonymise it. You can ask us to delete it sooner.</p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Ask what details we hold about you.</li>
        <li>Ask us to correct or delete them.</li>
        <li>Tell us to stop contacting you.</li>
      </ul>
      <p>Write to <a href={`mailto:${EMAIL}`} style={{ color: "#8ab4ff" }}>{EMAIL}</a> from the email address or phone number you gave us, and we will act on your request. See also <a href="/data-deletion" style={{ color: "#8ab4ff" }}>how to request deletion</a>.</p>

      <h2>Facebook and Instagram</h2>
      <p>When you submit a Facebook or Instagram lead form, Meta passes your answers to us. Meta&apos;s own handling of your data is governed by Meta&apos;s privacy policy. We only receive the information you chose to submit on the form.</p>

      <h2>Children</h2>
      <p>Our services are for adults. We do not knowingly collect information from anyone under 18.</p>

      <h2>Changes</h2>
      <p>We may update this policy. The date at the top shows when it last changed.</p>

      <h2>Contact</h2>
      <p>Relive Solutions Pvt. Ltd., Lucknow, Uttar Pradesh, India.<br />Email: <a href={`mailto:${EMAIL}`} style={{ color: "#8ab4ff" }}>{EMAIL}</a></p>
    </main>
  );
}
