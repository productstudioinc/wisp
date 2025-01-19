import { Icons } from "@/components/icons";
import { siteConfig } from "@/lib/config";
import {
  InstagramLogoIcon,
  LinkedInLogoIcon,
  TwitterLogoIcon,
} from "@radix-ui/react-icons";

interface Icon {
  id: string;
  icon: JSX.Element;
  url: string;
}

const icons: Icon[] = [
  { id: "linkedin", icon: <LinkedInLogoIcon />, url: "#" },
  { id: "instagram", icon: <InstagramLogoIcon />, url: "#" },
  { id: "twitter", icon: <TwitterLogoIcon />, url: "#" },
];

type Link = {
  id: string;
  text: string;
  url: string;
};

const links: Link[] = [
  { id: "contact", text: "Contact", url: "#" },
  { id: "terms", text: "Terms of Service", url: "/terms" },
  { id: "privacy", text: "Privacy Policy", url: "/privacy" },
];

export function Footer() {
  return (
    <footer className="flex flex-col gap-y-5 rounded-lg px-7 py-5 md:px-10 container">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <Icons.logo className="h-5 w-5" />
          <h2 className="text-lg font-bold text-foreground">
            {siteConfig.name}
          </h2>
        </div>

        <div className="flex gap-x-2">
          {icons.map((icon) => (
            <a
              key={icon.id}
              href={icon.url}
              className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-all duration-100 ease-linear hover:text-foreground hover:underline hover:underline-offset-4"
            >
              {icon.icon}
            </a>
          ))}
        </div>
      </div>
      <div className="flex flex-col justify-between gap-y-5 md:flex-row md:items-center">
        <ul className="flex flex-col gap-x-5 gap-y-2 text-muted-foreground md:flex-row md:items-center">
          {links.map((link) => (
            <li
              key={link.id}
              className="text-[15px]/normal font-medium text-muted-foreground transition-all duration-100 ease-linear hover:text-foreground hover:underline hover:underline-offset-4"
            >
              <a href={link.url}>{link.text}</a>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between text-sm font-medium tracking-tight text-muted-foreground">
          <p>All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
