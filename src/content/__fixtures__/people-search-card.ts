// Captured live 2026-06-26 / 2026-06-29 from a real authorised people-search (read-only).
// Structure is what harvestPeople (Connect-only) and harvestProfiles (any status) parse;
// hashed classes are irrelevant. Includes a connectable, a PENDING (already-invited) and a
// follow-only card — verified live: pending people keep the same member componentkey, only
// the suffix flips _connect → _pending and the anchor becomes a "Pending…" button.
export const PEOPLE_SEARCH_HTML = `
<div id="results">
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/olena-diachenko-2a5784266/?x=1">Olena Diachenko</a><span><span> • 2nd</span></span></p>
    <div><p><span>Frontend Developer | JavaScript | React | TypeScript</span></p></div>
    <div><p><span>Kyiv, Kyiv City, Ukraine</span></p></div>
  </div><div><div componentkey="SearchResultsACoAAEFBGJ0">
    <a href="/preload/search-custom-invite/?vanityName=olena" componentkey="ConnectButtonstate:invitation:urn:li:member:1094785181_connect" aria-label="Invite Olena Diachenko to connect"><span><span>Connect</span></span></a>
  </div></div></div>
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/yuliaobukhova/">Yulia O.</a><span><span> • 2nd</span></span></p>
    <div><p><span>IT &amp; Tech Talent Acquisition Specialist</span></p></div>
    <div><p><span>Chisinau, Moldova</span></p></div>
  </div><div><div componentkey="SearchResultsACoAABYulia">
    <button componentkey="ConnectButtonstate:invitation:urn:li:member:98425817_pending" aria-label="Pending, click to withdraw invitation sent to Yulia O."><span>Pending</span></button>
  </div></div></div>
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/predrag-vasic-18a273142/">Predrag Vasic</a><span><span> • 2nd</span></span></p>
    <div><p><span>Talent Acquisition Specialist | Technical Recruiter | IT Recruiter</span></p></div>
    <div><p><span>Serbia</span></p></div>
  </div><div><div componentkey="SearchResultsACoAACKRBDo">
    <a href="/preload/search-custom-invite/?vanityName=predrag" componentkey="ConnectButtonstate:invitation:urn:li:member:579929146_connect" aria-label="Invite Predrag Vasic to connect"><span><span>Connect</span></span></a>
  </div></div></div>
  <div><figure></figure><div>
    <p><a href="https://www.linkedin.com/in/shubh-yadav/">Shubh Yadav</a><span><span> • 2nd</span></span></p>
    <div><p><span>Engineering Recruiter</span></p></div>
  </div><div>
    <button aria-label="Follow Shubh Yadav">Follow</button>
  </div></div>
</div>`;
