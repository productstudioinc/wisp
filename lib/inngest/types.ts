import { EventSchemas } from 'inngest'

type ProjectCreateEvent = {
	data: {
		name: string
		description: string
		userId: string
		questions?: string
		additionalInfo?: string
		icon?: Blob
		images?: Blob[]
		private?: boolean
	}
}

type Events = {
	'project/create': ProjectCreateEvent
}

export const schemas = new EventSchemas().fromRecord<Events>()
