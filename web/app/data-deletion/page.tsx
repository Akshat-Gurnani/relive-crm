import type { Metadata } from "next";

export const metadata: Metadata = { title: "Data deletion | Relive Solutions", description: "How to ask Relive Solutions to delete your enquiry data." };

const EMAIL = "reliveakshatg@gmail.com";

export default function DataDeletion() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 80px", lineHeight: 1.65, fontSize: 15.5, color: "#e6e9f0" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Request deletion of your data</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Relive Solutions Pvt. Ltd., Lucknow, India.</p>

      <p>If you submitted an enquiry to Relive Solutions, for example through a Facebook or Instagram lead form, and you want us to delete the details we hold about you, follow these steps.</p>
      <ol>
        <li>Send an email to <a href={`mailto:${EMAIL}`} style={{ color: "#8ab4ff" }}>{EMAIL}</a> with the subject &quot;Delete my data&quot;.</li>
        <li>Write the name and phone number (or email address) you used on the form, so that we can find your enquiry.</li>
        <li>We will confirm your request and delete your enquiry, call records and notes from our system within 30 days. We will tell you when it is done.</li>
      </ol>
      <p>We may keep a minimal record where the law requires it. Deleting your data from our system does not delete anything held by Meta; you can manage that in your Facebook or Instagram settings.</p>
      <p>Read our full <a href="/privacy" style={{ color: "#8ab4ff" }}>Privacy Policy</a>.</p>
    </main>
  );
}
