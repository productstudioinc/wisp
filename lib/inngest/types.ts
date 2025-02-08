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

type ProjectUpdateEvent = {
	data: {
		id: string
		name: string
		description: string
		userId: string
	}
}

type Events = {
	'project/create': ProjectCreateEvent
	'project/update': ProjectUpdateEvent
}

export const schemas = new EventSchemas().fromRecord<Events>()
